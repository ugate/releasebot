'use strict';

var shell = require('shelljs');
var semver = require('semver');
var fs = require('fs');
var pth = require('path');
var util = require('util');
var pluginName = 'releasebot';
var configEnv = pluginName + '.env';
var configCommit = pluginName + '.commit';
var dfltVersionLabel = 'release';
var regexRelease = /(released?)\s*(v)((?:(\d+|\+|\*)(\.)(\d+|\+|\*)(\.)(\d+|\+|\*)(?:(-)(alpha|beta|rc?)(?:(\.)?(\d+|\+|\*))?)?))/mi;
var pluginDesc = 'Git commit message triggered grunt task that tags a release (GitHub Release API '
		+ 'supported), generates/uploads a release distribution asset archive, publishes a '
		+ 'distribution asset\'s content to a specified branch and publishes to npm when a '
		+ 'commit message matches the regular expression pattern: '
		+ regexRelease
		+ ' (for Travis CI set git: depth: in .travis.yml to a higher value than the default value '
		+ ' of 1 in order to properly capture change log)';
var regexVerCurr = /\*/;
var regexVerBump = /\+/g;
var regexSkips = /\[\s?skip\s+(.+)\]/gmi;
var regexSkipChgLog = /\[skip\s*CHANGELOG\]/gmi;
var regexSlug = /^(?:.+\/)(.+\/[^\.]+)/;
var regexLines = /(\r?\n)/g;
var regexDupLines = /^(.*)(\r?\n\1)+$/gm;
var regexKey = /(https?:\/\/|:)+(?=[^:]*$)[a-z0-9]+(@)/gmi;
var regexHost = /^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i;
var regexGitCmd = /^git/;
var gitHubHostname = 'github';
var gitHubRegexParam = /{(\?.+)}/;
var gitHubReleaseTagName = 'tag_name';
var gitHubReleaseUploadUrl = 'upload_url';
var gitHubReleaseCommitish = 'target_commitish';
var gitHubReleaseAssetId = 'id';
var gitHubReleaseId = 'id';
var gitHubReleaseName = 'name';
var gitHubReleaseBody = 'body';
// var gitHubReleaseDraftFlag = 'draft';
var gitHubReleasePreFlag = 'prerelease';
// var gitHubReleaseErrors = 'errors';
var gitHubReleaseErrorMsg = 'message';
var gitHubSuccessHttpCodes = [ 200, 201, 204 ];

/**
 * When a commit message contains "release v" followed by a valid version number
 * (major.minor.patch) a tagged release will be issued
 * 
 * @param grunt
 *            the grunt instance
 */
module.exports = function(grunt) {

	// initialize global release options set by
	// grunt.config.set(pluginName)
	var globalEnv = grunt.config.get(configEnv) || {};
	globalEnv = {
		pkgPath : grunt.config('pkgFile') || 'package.json',
		gitCliSubstitute : globalEnv.gitCliSubstitute
				|| grunt.option(pluginName + '.gitCliSubstitute') || '',
		buildDir : globalEnv.buildDir || grunt.option(pluginName + '.buildDir')
				|| process.env.TRAVIS_BUILD_DIR || process.cwd(),
		branch : globalEnv.branch || grunt.option(pluginName + '.branch')
				|| process.env.TRAVIS_BRANCH || '',
		commitNumber : globalEnv.commitNumber
				|| grunt.option(pluginName + '.commitNumber')
				|| process.env.TRAVIS_COMMIT || '',
		commitMessage : globalEnv.commitMessage
				|| grunt.option(pluginName + '.commitMessage')
				|| process.env.TRAVIS_COMMIT_MESSAGE || '',
		repoSlug : globalEnv.repoSlug || grunt.option(pluginName + '.repoSlug')
				|| process.env.TRAVIS_REPO_SLUG,
		gitToken : function() {
			return globalEnv.gitToken || grunt.option(pluginName + '.gitToken')
					|| process.env.GH_TOKEN || '';
		}
	};
	var commit = genCommit(globalEnv);

	// register release task
	grunt.registerTask(pluginName, pluginDesc, function() {
		var rx = regexRelease;
		var options = this.options({
			pkgJsonReplacer : null,
			pkgJsonSpace : 2,
			releaseVersionRegExp : rx,
			destBranch : 'gh-pages',
			destDir : 'dist',
			destExcludeDirRegExp : /.?node_modules.?/gmi,
			destExcludeFileRegExp : /.?\.zip|tar.?/gmi,
			chgLog : 'HISTORY.md',
			authors : 'AUTHORS.md',
			chgLogLineFormat : '  * %s',
			chgLogRequired : true,
			chgLogSkipLineRegExp : new RegExp('.*(?:' + rx.source + ')|('
					+ regexSkipChgLog.source + ')' + '.*\r?\n', 'g'
					+ (rx.multiline ? 'm' : '') + (rx.ignoreCase ? 'i' : '')),
			authorsRequired : false,
			authorsSkipLineRegExp : null,
			distAssetFormat : 'zip',
			distAssetCompressRatio : 9,
			gitHostname : gitHubHostname,
			distAssetUpdateFunction : null,
			distAssetUpdateFiles : [],
			npmTarget : '',
			npmTag : ''
		});
		release(this, options);
	});

	/**
	 * Initializes commit details and sets the results in the grunt
	 * configuration using the plug-in name
	 * 
	 * @param env
	 *            the global environment
	 */
	function genCommit(env) {
		grunt.config.set(configEnv, env);
		grunt.verbose
				.writeln('Global environment available via grunt.config.get("'
						+ configEnv + '"):\n' + util.inspect(env, {
							colors : true,
							depth : 3
						}));
		var cn = env.commitNumber;
		var cm = env.commitMessage;
		var br = env.branch;
		var rs = env.repoSlug;
		var un = '', rn = '';
		grunt.verbose.writeln('Searching for commit details...');
		function cmd(c) {
			var rtn = execCmd(c, env.gitCliSubstitute);
			if (rtn.code !== 0) {
				var e = new Error('Error "' + rtn.code + '" for ' + c + ' '
						+ rtn.output);
				grunt.log.error(e);
				throw e;
			}
			return rtn.output.replace(regexLines, '');
		}
		if (!br) {
			br = cmd('git rev-parse --abbrev-ref HEAD');
			grunt.verbose.writeln('Found branch: "' + br + '"');
		}
		if (!cn) {
			cn = cmd('git rev-parse HEAD');
			grunt.verbose.writeln('Found commit number: "' + cn + '"');
		}
		if (!cm) {
			// fall back on either last commit message or the commit message for
			// the current commit number
			cm = cmd("git show -s --format=%B " + env.commitNumber);
			grunt.verbose.writeln('Found commit message: "' + cm + '"');
		}
		if (!rs) {
			// fall back on capturing the repository slug from the current
			// remote
			rs = cmd("git ls-remote --get-url");
		}
		if (rs) {
			rs.replace(regexSlug, function(m, s) {
				var ss = s.split('/');
				un = ss[0];
				rn = ss[1];
				rs = s;
			});
			grunt.verbose.writeln('Found repo slug: "' + rs + '"');
		}
		var lver = execCmd('git describe --abbrev=0 --tags',
				env.gitCliSubstitute);
		if (lver.code !== 0 && !/No names found/i.test(lver.output)) {
			throw new Error('Error capturing last version ' + lver.output);
		}
		lver = lver.code === 0 ? dfltVersionLabel
				+ lver.output.replace(regexLines, '') : '';
		grunt.verbose.writeln('Found last release version: "' + lver + '"');
		var c = new Commit(cm, lver, env.gitCliSubstitute, cn, env.pkgPath,
				env.buildDir, br, rs, un, rn, env.gitToken);
		cloneAndSetCommit(c);
		return c;
	}

	/**
	 * Clones a {Commit} and sets the cloned value in the Grunt configuration
	 * 
	 * @param c
	 *            the {Commit} to clone
	 */
	function cloneAndSetCommit(c) {
		var cc = clone(c, [ c.skipTaskCheck, c.skipTaskGen, c.versionSetPkg,
				c.versionGetPkg ], [ c.versionMatch, c.gitCliSubstitute,
				c.pkgPath ]);
		grunt.config.set(configCommit, cc);
		grunt.verbose
				.writeln('The following read-only object is now accessible via grunt.config.get("'
						+ configCommit + '"):\n' + util.inspect(cc, {
							colors : true,
							depth : 3
						}));
		// grunt.log.writeflags(o,
		// 'The following read-only properties are now accessible via
		// grunt.config.get("'
		// + configCommit + '")');
	}

	/**
	 * Clones an object
	 * 
	 * @param c
	 *            the {Commit} to clone
	 * @param incFuncs
	 *            an array of functions that will be included in the clone (null
	 *            to include all)
	 * @param excludes
	 *            an array of property values that will be excluded from the
	 *            clone
	 * @returns {Object} clone
	 */
	function clone(c, incFuncs, excludes) {
		var cl = {}, cp, t;
		for ( var keys = Object.keys(c), l = 0; l < keys.length; l++) {
			cp = c[keys[l]];
			if (excludes && excludes.indexOf(cp) >= 0) {
				continue;
			}
			if (Array.isArray(cp)) {
				cl[keys[l]] = cp.slice(0);
			} else if ((t = typeof cp) === 'function') {
				if (!incFuncs || incFuncs.indexOf(cp) >= 0) {
					cl[keys[l]] = cp; // cp.bind(cp);
				}
			} else if (cp == null || t === 'string' || t === 'number'
					|| t === 'boolean' || util.isRegExp(cp) || util.isDate(cp)
					|| util.isError(cp)) {
				cl[keys[l]] = cp;
			} else if (t !== 'undefined') {
				cl[keys[l]] = clone(cp, incFuncs);
			}
		}
		return cl;
	}

	/**
	 * Basic Commit {Object} that extracts/bumps/sets version numbers
	 * 
	 * @constructor
	 * @param cm
	 *            the commit message to extract the versions from
	 * @param pcm
	 *            an optional commit message from a previous release
	 * @param gitCliSubstitute
	 *            the optional command replacement that will be substituted for
	 *            the "git" CLI (when applicable)
	 * @param cn
	 *            the commit number
	 * @param pkgPath
	 *            the path to the package file
	 * @param buildDir
	 *            the directory to the build
	 * @param branch
	 *            the branch name
	 * @param slug
	 *            the repository slug
	 * @param username
	 *            the name of the Git user
	 * @param reponame
	 *            the repository name
	 * @param gitToken
	 *            a function that will be used to extract the Git token
	 */
	function Commit(cm, pcm, gitCliSubstitute, cn, pkgPath, buildDir, branch,
			slug, username, reponame, gitToken) {
		var rv = cm ? cm.match(regexRelease) : [];
		if (!rv) {
			rv = [];
		}
		var self = this;
		var vt = 0, si = -1, vlp = '';
		this.publishedNpmTarget = '';
		this.gitCliSubstitute = gitCliSubstitute;
		this.pkgPath = pkgPath;
		this.number = cn;
		this.buildDir = buildDir;
		this.branch = branch;
		this.slug = slug;
		this.username = username;
		this.reponame = reponame;
		this.gitToken = gitToken || '';
		this.releaseId = null;
		this.releaseAssetUrl = '';
		this.releaseAsset = null;
		this.skipTasks = [];
		this.skipTaskGen = function(task) {
			return task ? '[skip ' + task + ']' : task;
		};
		this.skipTaskCheck = function(task) {
			return self.skipTasks && self.skipTasks.indexOf(task) >= 0;
		};
		if (cm) {
			// extract skip tasks in format: [skip someTask]
			cm.replace(regexSkips, function(m, t) {
				self.skipTasks.push(t);
			});
		}
		this.message = cm;
		this.versionMatch = rv;
		this.versionBumpedIndices = [];
		this.versionLastIndices = [];
		this.versionVacant = function() {
			return !this.versionMajor && !this.versionMinor
					&& !this.versionPatch && !this.versionPrerelease;
		};
		this.lastCommit = pcm ? new Commit(pcm) : {};
		this.versionLabel = rv.length > 1 ? rv[1] : '';
		this.versionType = rv.length > 2 ? rv[2] : '';
		this.versionPrereleaseType = rv.length > 10 ? rv[10] : '';
		this.versionMajor = rv.length > 4 ? verMatchVal(4) : 0;
		this.versionMinor = rv.length > 6 ? verMatchVal(6) : 0;
		this.versionPatch = rv.length > 8 ? verMatchVal(8) : 0;
		this.versionPrerelease = rv.length > 12 ? verMatchVal(12) : 0;
		this.version = this.versionLastIndices.length
				|| this.versionBumpedIndices.length ? vv(4, this.versionMajor)
				+ vv(5)
				+ vv(6, this.versionMinor)
				+ vv(7)
				+ vv(8, this.versionPatch)
				+ vv(9)
				+ vv(10, this.versionPrereleaseType)
				+ vv(11)
				+ (this.versionPrereleaseType ? vv(12, this.versionPrerelease)
						: '') : rv.length > 3 ? rv[3] : '';
		this.versionTag = rv.length > 3 ? rv[2] + this.version : '';
		this.versionSetPkg = function(replacer, space, revert) {
			var pkg = self.versionGetPkg(self.pkgPath);
			var u = self.pkgPath && !revert && pkg.version !== self.version;
			var r = self.pkgPath && revert && pkg.version !== vlp
					&& (!vlp ? vlp = pkg.version : vlp);
			if (u || r) {
				pkg.version = r ? vlp : self.version;
				grunt.file.write(self.pkgPath, JSON.stringify(pkg, replacer,
						space));
				if (u) {
					vlp = pkg.version;
				}
			}
			return u || r;
		};
		this.versionGetPkg = function() {
			return grunt.file.readJSON(self.pkgPath);
		};
		function verMatchVal(i) {
			var v = self.versionMatch[i];
			var vl = self.lastCommit.versionMatch
					&& self.lastCommit.versionMatch.length > i
					&& self.lastCommit.versionMatch[i] ? parseInt(self.lastCommit.versionMatch[i])
					: 0;
			var vr = 0;
			si++;
			if (v && regexVerBump.test(v)) {
				// increment the value for the given slot
				self.versionBumpedIndices.push(si);
				var m = v.match(regexVerBump);
				vr = vl + m.length;
			} else if (v && regexVerCurr.test(v)) {
				// use the last release value for the given slot
				self.versionLastIndices.push(si);
				vr = vl;
			} else if (v) {
				vr = parseInt(v);
			}
			vt += vr;
			return vr;
		}
		function vv(i, v) {
			return self.versionMatch.length > i ? typeof v !== 'undefined' ? v
					: typeof self.versionMatch[i] !== 'undefined' ? self.versionMatch[i]
							: ''
					: '';
		}
	}

	/**
	 * When a release commit message is received a release is performed and a
	 * repository web site is published
	 * 
	 * @param task
	 *            the currently running task
	 * @param options
	 *            the task options
	 */
	function release(task, options) {
		var doneAsync = null;

		// validate commit
		if (!validateCommit()) {
			return;
		}
		grunt.log.writeln('Preparing release: '
				+ commit.version
				+ ' (last release: '
				+ (commit.lastCommit.versionTag ? commit.lastCommit.versionTag
						: 'N/A') + ')');
		var useGitHub = options.gitHostname.toLowerCase() === gitHubHostname;
		var relMsg = commit.message + ' ' + commit.skipTaskGen('ci');
		var chgLogRtn = '', distAsset = '';

		// Queue/Start work
		var que = new Queue().add(changeLog).add(authorsLog).add(remoteSetup);
		que.add(pkgUpdate, rollbackPkg);
		que.add(addAndCommitDestDir).add(genDistAsset);
		que.add(function() {
			if (useGitHub) {
				doneAsync = task.async();
				que.add(gitHubRelease);
			} else {
				que.add(gitRelease);
			}
		});
		// begin release
		que.start(function(rbcnt) {
			// complete process
			if (this.errorCount() > 0) {
				grunt.log.writeln('Processed ' + rbcnt + ' rollback actions');
			} else {
				try {
					cloneAndSetCommit(commit);
				} catch (e) {
					que.error('Failed to set global commit result properties',
							e);
				}
				try {
					cmd('git checkout -q ' + (commit.number || commit.branch));
				} catch (e) {
					que.error(e);
				}
				if (doneAsync) {
					doneAsync(que.errorCount() <= 0);
				} else if (que.errorCount() > 0) {
					throw new Error('Release failed');
				}
			}
		});

		/**
		 * Generates/Writes a change log for the current release using all
		 * messages since last tag/release
		 * 
		 * @returns true to stop further processing
		 */
		function changeLog() {
			// Generate change log for release using all messages since last
			// tag/release
			var chgLogPath = options.destDir + '/' + options.chgLog;
			var lastGitLog = commit.lastCommit && commit.lastCommit.version ? commit.lastCommit.versionTag
					+ '..HEAD'
					: 'HEAD';
			chgLogRtn = cmd('git --no-pager log ' + lastGitLog
					+ ' --pretty=format:"' + options.chgLogLineFormat + '" > '
					+ chgLogPath, null, false, chgLogPath,
					options.chgLogSkipLineRegExp, '<!-- Commit '
							+ commit.number + ' -->\n')
					|| '';
			return options.chgLogRequired && !validateFile(chgLogPath);
		}

		/**
		 * Generates/Writes an authors log for the current release using all
		 * authors since last tag/release
		 * 
		 * @returns true to stop further processing
		 */
		function authorsLog() {
			// Generate list of authors/contributors since last tag/release
			var authorsPath = options.destDir + '/' + options.authors;
			cmd('git --no-pager shortlog -sen HEAD > ' + authorsPath, null,
					false, authorsPath, options.authorsSkipLineRegExp);
			return options.authorsRequired && !validateFile(authorsPath);
		}

		/**
		 * Remote Git setup to premit pushes
		 */
		function remoteSetup() {
			var link = '${GH_TOKEN}@github.com/' + commit.slug + '.git';
			cmd('git config --global user.email "travis@travis-ci.org"');
			cmd('git config --global user.name "travis"');
			cmd('git remote rm origin');
			cmd('git remote add origin https://' + commit.username + ':' + link);
		}

		/**
		 * Pushes package version update
		 */
		function pkgUpdate() {
			commitPkg();
		}

		/**
		 * Adds/Commits everything in the destination directory for tracking
		 */
		function addAndCommitDestDir() {
			if (true) {
				throw new Error('TEST ERROR');
			}
			// Commit changes to master (needed to generate archive asset)
			cmd('git add --force ' + options.destDir);
			cmd('git commit -q -m "' + relMsg + '"');
		}

		/**
		 * Generates distribution archive asset
		 */
		function genDistAsset() {
			// Create distribution assets
			distAsset = commit.reponame + '-' + commit.version + '-dist.'
					+ options.distAssetFormat;
			cmd('git archive -o ' + distAsset + ' --format='
					+ options.distAssetFormat + ' -'
					+ options.distAssetCompressRatio + ' HEAD:'
					+ options.destDir);
		}

		/**
		 * Tags release via standard Git CLI
		 */
		function gitRelease() {
			// Tag release
			grunt.log.writeln('Tagging release ' + commit.versionTag + ' via '
					+ options.gitHostname);
			cmd('git tag -f -a ' + commit.versionTag + ' -m "'
					+ chgLogRtn.replace(regexLines, '$1 \\') + '"');
			cmd('git push -f origin ' + commit.versionTag);
			// TODO : upload asset?
			que.add(publish, rollbackTag);
		}

		/**
		 * Calls the GitHub Release API to tag release and upload optional
		 * distribution asset
		 */
		function gitHubRelease() {
			grunt.log.writeln('Releasing ' + commit.versionTag + ' via '
					+ options.gitHostname);
			releaseAndUploadAsset({
				path : distAsset,
				name : distAsset
			}, 'application/zip', commit, chgLogRtn, options, que, function() {
				// GitHub Release API will not remove the tag when removing a
				// release (thus tag rollback)
				que.add(publish, rollbackTag);
			});
		}

		/**
		 * Publish repository pages to destination branch (commit should have a
		 * valid ID)
		 */
		function publish() {
			if (!commit.releaseId) {
				grunt.log.writeln('No release ID Skipping publishing to '
						+ options.destBranch);
			} else if (options.destBranch) {
				grunt.log.writeln('Publishing to ' + options.destBranch);
				if (distAsset) {
					// remove uploaded asset file to prevent conflicts
					fs.unlinkSync(distAsset);
				}
				var destPath = pth.join(commit.buildDir, options.destDir);
				var ghPath = commit.buildDir.replace(commit.reponame,
						options.destBranch);
				// copy all directories/files over that need to be published
				// so that they are not removed by the following steps
				grunt.log.writeln(copyRecursiveSync(destPath, ghPath,
						options.destExcludeDirRegExp,
						options.destExcludeFileRegExp).toString());
				// cmd('cp -r ' + pth.join(destPath, '*') + ' ' + ghPath);
				cmd('git fetch origin ' + options.destBranch);
				cmd('git checkout -q --track origin/' + options.destBranch);
				cmd('git rm -rfq .');
				cmd('git clean -dfq .');
				grunt.log.writeln('Copying publication directories/files from '
						+ ghPath + ' to ' + commit.buildDir);
				grunt.log.writeln(copyRecursiveSync(ghPath, commit.buildDir)
						.toString());
				// cmd('cp -r ' + pth.join(ghPath, '*') + ' .');

				// give taskateers a chance to update asset contents
				updatePublishAssets(commit.buildDir);

				cmd('git add -A && git commit -m "' + relMsg + '"');
				cmd('git push -f origin ' + options.destBranch);

				que.add(publishNpm, rollbackPublish);
			}
		}

		/**
		 * npm publish
		 */
		function publishNpm() {
			// publish to npm
			if (commit.pkgPath && typeof options.npmTarget === 'string') {
				var npmc = 'npm publish ' + options.npmTarget
						+ (options.npmTag ? ' --tag ' + options.npmTag : '');
				cmd(npmc);
			}
		}

		/**
		 * Deletes tag using Git CLI
		 */
		function rollbackTag() {
			cmd('git push --delete origin ' + commit.versionTag);
		}

		/**
		 * Reverts published branch
		 */
		function rollbackPublish() {
			try {
				// TODO : rollback publish
			} catch (e) {
				var msg = 'Failed to revert publish branch!';
				que.error(msg, e);
			}
		}

		/**
		 * Pushes package version update
		 */
		function rollbackPkg() {
			commitPkg(true);
		}

		/**
		 * Updates the package file version using the current {Commit} version
		 * (or reverted version) and commits/pushes it to remote
		 * 
		 * @param revert
		 *            true to revert package version
		 * @returns {Boolean} true when successful
		 */
		function commitPkg(revert) {
			if (commit.pkgPath
					&& commit.versionSetPkg(options.pkgJsonReplacer,
							options.pkgJsonSpace, revert)) {
				// push package version
				cmd('git commit -q -m "' + relMsg + '"');
				cmd('git push origin ' + commit.pkgPath);
			}
		}

		/**
		 * Executes a shell command
		 * 
		 * @param c
		 *            the command string to execute
		 * @param wpath
		 *            the optional path/file to write the results to
		 * @param nofail
		 *            true to prevent throwing an error when the command fails
		 *            to execute
		 * @param dupsPath
		 *            path to the command output that will be read, duplicate
		 *            entry lines removed and re-written
		 * @param dupsSkipLineRegExp
		 *            an optional {RegExp} to use for eliminating specific
		 *            content from the output (only used when in conjunction
		 *            with a valid duplicate path)
		 * @param dupsPrefix
		 *            an optional prefix to the duplication replacement path
		 */
		function cmd(c, wpath, nofail, dupsPath, dupsSkipLineRegExp, dupsPrefix) {
			grunt.log.writeln(c);
			var rtn = null;
			if (typeof c === 'string') {
				rtn = execCmd(c, commit.gitCliSubstitute);
			} else {
				rtn = shell[c.shell].apply(shell, c.args);
			}
			if (rtn.code !== 0) {
				var e = 'Error "' + rtn.code + '" for commit number '
						+ commit.number + ' ' + rtn.output;
				if (nofail) {
					que.error(e);
					return;
				}
				throw grunt.util.error(e);
			}
			var output = rtn.output;
			if (output) {
				output = output.replace(regexKey, '$1[SECURE]$2');
			}
			if (output && wpath) {
				grunt.file.write(wpath, output);
			}
			if (dupsPath) {
				// remove duplicate lines
				if (!output) {
					output = grunt.file.read(dupsPath, {
						encoding : grunt.file.defaultEncoding
					});
				}
				if (output) {
					// replace duplicate lines
					output = (dupsPrefix ? dupsPrefix : '')
							+ output.replace(regexDupLines, '$1');
					if (util.isRegExp(dupsSkipLineRegExp)) {
						// optionally skip lines that match expression
						output = output.replace(dupsSkipLineRegExp, '');
					}
					grunt.file.write(dupsPath, output);
				}
			}
			if (output) {
				grunt.log.writeln(output);
				return output;
			}
			return '';
		}

		/**
		 * Updates any publishing asset content using functions from options
		 * 
		 * @param path
		 *            the base path to that will be used to prefix each file
		 *            used in the update process
		 * @returns {String} the replaced URL (undefined if nothing was
		 *          replaced)
		 */
		function updatePublishAssets(path) {
			try {
				if (options.distAssetUpdateFiles
						&& typeof options.distAssetUpdateFunction === 'function') {
					var paths = options.distAssetUpdateFiles;
					for ( var i = 0; i < paths.length; i++) {
						var p = pth.join(path, paths[i]), au = '';
						var content = grunt.file.read(p, {
							encoding : grunt.file.defaultEncoding
						});
						var ec = options.distAssetUpdateFunction(content, p,
								commit);
						if (content !== ec) {
							grunt.file.write(p, ec);
							return au;
						}
					}
				}
			} catch (e) {
				que.error('Unable to update publish release asset URL', e);
			}
		}

		/**
		 * Determines if a file has content and logs an error when the the file
		 * is empty
		 * 
		 * @param path
		 *            the path to the file
		 * @returns true when the file contains data or the path is invalid
		 */
		function validateFile(path) {
			var stat = path ? fs.statSync(path) : {
				size : 0
			};
			if (!stat.size) {
				que.error('Failed to find any entries in "' + path
						+ '" (file size: ' + stat.size + ')');
				return false;
			}
			return true;
		}

		/**
		 * @returns {Boolean} true when validation passes
		 */
		function validateCommit() {
			if (!commit.version) {
				grunt.verbose.writeln('Non-release commit '
						+ (commit.version || ''));
				return false;
			} else if (commit.lastCommit.versionTag
					&& !semver.gt(commit.version, commit.lastCommit.version)) {
				throw grunt.util.error(commit.version
						+ ' must be higher than the last release version '
						+ commit.lastCommit.version);
			}
			return true;
		}
	}

	/**
	 * Executes a shell command
	 * 
	 * @param c
	 *            the command to execute
	 * @param gcr
	 *            the optional command replacement that will be substituted for
	 *            the "git" CLI (when applicable)
	 */
	function execCmd(c, gcr) {
		return shell.exec(gcr ? c.replace(regexGitCmd, gcr) : c, {
			silent : true
		});
	}

	/**
	 * Copies files/directories recursively
	 * 
	 * @param src
	 *            the source path
	 * @param dest
	 *            the destination path
	 * @param dirExp
	 *            an optional regular expression that will be tested for
	 *            exclusion before each directory is copied
	 * @param fileExp
	 *            an optional regular expression that will be tested for
	 *            exclusion before each file is copied
	 * @returns {Object} status of the copied resources
	 */
	function copyRecursiveSync(src, dest, dirExp, fileExp) {
		var stats = {
			dirCopiedCount : 0,
			dirSkips : [],
			fileCopiedCount : 0,
			fileSkips : [],
			toString : function() {
				return this.dirCopiedCount
						+ ' directories/'
						+ this.fileCopiedCount
						+ ' files copied'
						+ (this.dirSkips.length > 0 ? ' Skipped directories: '
								+ this.dirSkips.join(',') : '')
						+ (this.fileSkips.length > 0 ? ' Skipped files: '
								+ this.fileSkips.join(',') : '');
			}
		};
		crs(stats, src, dest, dirExp, fileExp);
		return stats;
		function safeStatsSync(s) {
			var r = {};
			r.exists = fs.existsSync(s);
			r.stats = r.exists && fs.statSync(s);
			r.isDir = r.exists && r.stats.isDirectory();
			return r;
		}
		function crs(s, src, dest, dirExp, fileExp) {
			var srcStats = safeStatsSync(src);
			if (srcStats.exists && srcStats.isDir) {
				if (dirExp && util.isRegExp(dirExp) && dirExp.test(src)) {
					s.dirSkips.push(src);
					return;
				}
				var destStats = safeStatsSync(dest);
				if (!destStats.exists) {
					fs.mkdirSync(dest);
				}
				s.dirCopiedCount++;
				fs.readdirSync(src).forEach(function(name) {
					crs(s, pth.join(src, name), pth.join(dest, name));
				});
			} else {
				if (fileExp && util.isRegExp(fileExp) && fileExp.test(src)) {
					s.fileSkips.push(src);
					return;
				}
				fs.linkSync(src, dest);
				s.fileCopiedCount++;
			}
		}
	}

	/**
	 * Tags/Releases from default branch (see
	 * http://developer.github.com/v3/repos/releases/#create-a-release ) and
	 * Uploads the file asset and associates it with a specified tagged release
	 * (see
	 * http://developer.github.com/v3/repos/releases/#upload-a-release-asset )
	 * 
	 * @param asset
	 *            an object containing a <code>path</code> and
	 *            <code>name</code> of the asset to be uploaded
	 * @param contentType
	 *            the content type of the file being uploaded
	 * @param commit
	 *            the commit object the asset is for
	 * @param desc
	 *            release description (can be in markdown)
	 * @param options
	 *            the task options
	 * @param que
	 *            the {Queue} instance
	 * @param cb
	 *            the call back function (passed parameters: the current task,
	 *            JSON response, error)
	 */
	function releaseAndUploadAsset(asset, contentType, commit, desc, options,
			que, cb) {
		var authToken = typeof commit.gitToken === 'function' ? commit
				.gitToken() : commit.gitToken;
		if (!authToken) {
			que.error('Invalid authorization token').add(cb);
			return;
		}
		var data = '', data2 = '', rl = null, cf = null;
		// check if API responded with an error message
		function chk(o) {
			if (o[gitHubReleaseErrorMsg]) {
				throw grunt.util.error(JSON.stringify(o));
			}
			return o;
		}
		var json = {};
		json[gitHubReleaseTagName] = commit.versionTag;
		json[gitHubReleaseName] = commit.versionTag;
		json[gitHubReleaseBody] = desc;
		json[gitHubReleaseCommitish] = commit.number;
		json[gitHubReleasePreFlag] = commit.versionPrereleaseType != null;
		json = JSON.stringify(json);
		var fstat = asset && asset.path ? fs.statSync(asset.path) : {
			size : 0
		};
		var host = 'api.github.com';
		var releasePath = '/repos/' + commit.slug + '/releases';
		var https = require('https');
		var opts = {
			hostname : host,
			port : 443,
			path : releasePath,
			method : 'POST'
		};
		opts.headers = {
			'User-Agent' : commit.slug,
			'Authorization' : 'token ' + authToken,
			'Content-Type' : 'application/json',
			'Content-Length' : json.length
		};

		// queue request
		que.add(postRelease);

		function postRelease() {
			// pause and wait for response
			que.pause();
			var res = null;
			var req = https.request(opts, function(r) {
				// var sc = res.statusCode;
				res = r;
				res.on('data', function(chunk) {
					data += chunk;
				});
				res.on('end', function() {
					if (gitHubSuccessHttpCodes.indexOf(res.statusCode) >= 0) {
						que.add(postReleaseEnd).resume();
					} else {
						que.error(
								'Release post failed with HTTP status: '
										+ res.statusCode + ' data: ' + data)
								.add(cb).resume();
					}
				});
			});
			req.end(json);
			req.on('error', function(e) {
				que.error('Release post failed', e).add(cb).resume();
			});
			function postReleaseEnd() {
				var success = gitHubSuccessHttpCodes.indexOf(res.statusCode) >= 0;
				rl = success ? chk(JSON.parse(data.replace(regexLines, ' ')))
						: null;
				if (rl && rl[gitHubReleaseTagName] === commit.versionTag) {
					commit.releaseId = rl[gitHubReleaseId];
					// queue asset uploaded or complete with callback
					que.add(fstat.size <= 0 ? cb : postReleaseAsset,
							postReleaseRollback);
				} else {
					que.error(
							'No tag found for ' + commit.versionTag + ' in '
									+ util.inspect(rl, {
										colors : true
									}) + ' HTTP Status: ' + res.statusCode
									+ ' Response: \n' + data).add(cb);
				}
			}
		}

		function postReleaseAsset() {
			grunt.log.writeln('Uploading "' + asset.path
					+ '" release asset for ' + commit.versionTag + ' via '
					+ options.gitHostname);
			opts.method = 'POST';
			opts.path = rl[gitHubReleaseUploadUrl].replace(regexHost, function(
					m, h) {
				opts.hostname = h;
				return '/';
			});
			opts.path = opts.path.replace(gitHubRegexParam, '$1='
					+ (asset.name || commit.versionTag));
			opts.headers['Content-Type'] = contentType;
			opts.headers['Content-Length'] = fstat.size;
			que.pause();
			var res2 = null;
			var req2 = https.request(opts, function(r) {
				res2 = r;
				res2.on('data', function(chunk) {
					grunt.log.writeln('Receiving chunked data');
					data2 += chunk;
				});
				res2.on('end', function() {
					if (gitHubSuccessHttpCodes.indexOf(res2.statusCode) >= 0) {
						que.add(postRleaseAssetEnd).resume();
					} else {
						que.error(
								'Asset upload failed with HTTP status: '
										+ res2.statusCode + ' data: ' + data)
								.add(cb).resume();
					}
				});
				grunt.log.writeln('Waiting for response');
			});
			req2.on('error', function(e) {
				que.error('Release asset upload failed', e).add(cb).resume();
			});
			// stream asset to remote host
			fs.createReadStream(asset.path, {
				'bufferSize' : 64 * 1024
			}).pipe(req2);

			function postRleaseAssetEnd() {
				if (gitHubSuccessHttpCodes.indexOf(res2.statusCode) >= 0) {
					cf = chk(JSON.parse(data2.replace(regexLines, ' ')));
					if (cf && cf.state !== 'uploaded') {
						var msg = 'Asset upload failed with state: ' + cf.state
								+ ' for ' + util.inspect(cf, {
									colors : true
								});
						que.error(msg);
					} else {
						commit.releaseAsset = cf;
						commit.releaseAssetUrl = 'https://'
								+ options.gitHostname + '.com/'
								+ commit.username + '/' + commit.reponame
								+ '/releases/download/' + commit.versionTag
								+ '/' + cf[gitHubReleaseName];
						grunt.log.writeln('Asset ID '
								+ cf[gitHubReleaseAssetId] + ' successfully '
								+ cf.state + ' for ' + asset);
					}
				} else {
					que.error('Asset upload failed!', data2);
				}
				que.add(cb);
			}
		}

		function postReleaseRollback() {
			try {
				// rollback release
				opts.path = releasePath + '/' + commit.releaseId.toString();
				opts.method = 'DELETE';
				opts.hostname = host;
				opts.headers['Content-Length'] = 0;
				grunt.log.writeln('Rolling back ' + commit.versionTag
						+ ' release via ' + options.gitHostname + ' '
						+ opts.method + ' ' + opts.path);
				var rreq = https.request(opts, function(res) {
					var rrdata = '';
					res.on('data', function(chunk) {
						grunt.log.writeln('Receiving chunked data');
						rrdata += chunk;
					});
					res.on('end',
							function() {
								var msg = 'Release rollback for release ID: '
										+ commit.releaseId;
								if (gitHubSuccessHttpCodes
										.indexOf(res.statusCode) >= 0) {
									grunt.log.writeln(msg + ' complete');
									grunt.verbose.writeln(rrdata);
								} else {
									que.error(msg + ' failed', rrdata);
								}
							});
				});
				rreq.end();
				rreq.on('error', function(e) {
					que.error('Failed to rollback release ID '
							+ commit.releaseId, e);
				});
			} catch (e) {
				que.error('Failed to request rollback for release ID '
						+ commit.releaseId, e);
			}
		}
	}

	function Queue() {
		var wrk = null, wrkq = [], wrkd = [], wrkrb = [], que = this, wi = 0, endc = null, pausd = false, es = new Errors();
		this.add = function(fx, rb) {
			wrk = new Work(fx, rb, Array.prototype.slice.call(arguments, 2));
			wrkq.push(wrk);
			return que;
		};
		this.work = function() {
			return wrk;
		};
		this.start = function(end) {
			endc = end || endc;
			var stop = false;
			pausd = false;
			for ( var l = wrkq.length; wi < l; wi++) {
				wrk = wrkq[wi];
				try {
					wrk.run();
					if (pausd) {
						pausd = false;
						return;
					}
				} catch (e) {
					stop = true;
					que.error(e);
				} finally {
					if (stop || wi === l - 1) {
						return endc ? endc.call(que, rollbacks()) : false;
					}
				}
			}
		};
		this.pause = function() {
			pausd = true;
			return que;
		};
		this.resume = function() {
			return que.start();
		};
		this.worked = function() {
			return wrkd.slice(0);
		};
		this.error = function() {
			es.log.apply(es, arguments);
			return que;
		};
		this.errorCount = function() {
			return es.count();
		};
		function rollbacks() {
			var cnt = 0;
			if (que.errorCount() > 0) {
				for ( var i = 0, l = wrkrb.length; i < l; i++) {
					try {
						cnt++;
						grunt.verbose.writeln('Calling rollback: '
								+ wrkrb[i].rb);
						if (wrkrb[i].rb()) {
							return cnt;
						}
					} catch (e) {
						cnt--;
						que.error('Rollback failed', e);
					}
				}
			}
			return cnt;
		}
		function Work(fx, rb, args) {
			var orb = rb;
			this.func = fx;
			this.rb = function() {
				return orb ? orb.call(que) : false;
			};
			this.args = args;
			this.rtn = undefined;
			this.run = function() {
				this.rtn = fx.apply(que, this.args);
				wrkd.push(this);
				if (orb) {
					wrkrb.unshift(this);
				}
				return this.rtn;
			};
		}
	}

	/**
	 * Work/Error tracking
	 * 
	 * @constructor
	 */
	function Errors() {
		var errors = [];

		/**
		 * Logs one or more errors (can be {Error}, {Object} or {String})
		 */
		this.log = function() {
			for ( var i = 0; i < arguments.length; i++) {
				if (util.isArray(arguments[i])) {
					this.log(arguments[i]);
				} else {
					logError(arguments[i]);
				}
			}
		};

		/**
		 * @returns the number of errors logged
		 */
		this.count = function() {
			return errors.length;
		};

		/**
		 * Logs an error
		 * 
		 * @param e
		 *            the {Error} object or string
		 */
		function logError(e) {
			e = e instanceof Error ? e : e ? grunt.util.error(e) : null;
			if (e) {
				errors.unshift(e);
				grunt.log.error(e.stack || e.message);
			}
		}
	}
};
