'use strict';

var shell = require('shelljs');
var semver = require('semver');
var fs = require('fs');
var pth = require('path');
var util = require('util');
var pluginName = 'releasebot';
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
var regexVerExt = new RegExp(regexVerCurr.source + '|' + regexVerBump.source);
var regexSkips = /\[\s?skip\s+(.+)\]/gmi;
var regexSkipChgLog = /\[skip\s*CHANGELOG\]/gmi;
var regexLastVer = /v(?=[^v]*$).+/g;
var regexLines = /(\r?\n)/g;
var regexDupLines = /^(.*)(\r?\n\1)+$/gm;
var regexKey = /(https?:\/\/|:)+(?=[^:]*$)[a-z0-9]+(@)/gmi;
var regexHost = /^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i;
var gitHubHostname = 'github';
var gitHubRegexParam = /{(\?.+)}/;
var gitHubReleaseTagName = 'tag_name';
var gitHubReleaseUploadUrl = 'upload_url';
var gitHubReleaseCommitish = 'target_commitish';
var gitHubReleaseAssetId = 'id';
var gitHubReleaseId = 'id';
var gitHubReleaseName = 'name';
var gitHubReleaseBody = 'body';
var gitHubReleaseDraftFlag = 'draft';
var gitHubReleasePreFlag = 'prerelease';
var gitHubReleaseErrors = 'errors';
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
	var dftCommitOpts = grunt.config.get(pluginName) || {};
	dftCommitOpts = {
		pkg : grunt.config('pkgFile') || 'package.json',
		buildDir : dftCommitOpts.buildDir
				|| grunt.option(pluginName + '.buildDir')
				|| process.env.TRAVIS_BUILD_DIR || process.cwd(),
		branch : dftCommitOpts.branch || grunt.option(pluginName + '.branch')
				|| process.env.TRAVIS_BRANCH || '',
		commitNumber : dftCommitOpts.commitNumber
				|| grunt.option(pluginName + '.commitNumber')
				|| process.env.TRAVIS_COMMIT || '',
		commitMessage : dftCommitOpts.commitMessage
				|| grunt.option(pluginName + '.commitMessage')
				|| process.env.TRAVIS_COMMIT_MESSAGE || '',
		repoSlug : dftCommitOpts.repoSlug
				|| grunt.option(pluginName + '.repoSlug')
				|| process.env.TRAVIS_REPO_SLUG,
		gitToken : dftCommitOpts.gitToken
				|| grunt.option(pluginName + '.gitToken') || function() {
					return process.env.GH_TOKEN;
				}
	};
	set(null, dftCommitOpts);

	// register release task
	grunt.registerTask(pluginName, pluginDesc, function() {
		var rx = regexRelease;
		var options = this.options({
			releaseVersionRegExp : rx,
			destBranch : 'gh-pages',
			destDir : 'dist',
			destExcludeDirRegExp : /.?node_modules.?/gmi,
			destExcludeFileRegExp : /.?\.zip.?/gmi,
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
			npmTarget : ''
		});
		release(this, options);
	});

	/**
	 * Initializes release details and sets the results in the grunt
	 * configuration using the plug-in name
	 * 
	 * @param task
	 *            the currently running task
	 * @param options
	 *            the task options
	 */
	function set(task, options) {
		var cn = options.commitNumber;
		var cm = options.commitMessage;
		var br = options.branch;
		var rs = options.repoSlug;
		function cmd(c) {
			var rtn = shell.exec(c, {
				silent : true
			});
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
		}
		if (!cn) {
			cn = cmd('git rev-parse HEAD');
		}
		if (!cm) {
			// fall back on either last commit message or the commit message for
			// the current commit number
			cm = cmd("git show -s --format=%B " + options.commitNumber
					+ " | tr -d '\\n'");
		}
		if (!rs) {
			// fall back on capturing the repository slug from the current
			// remote
			rs = cmd("git remote -v | head -n1 | awk '{print $2}' | sed -e 's,.*:\\([^/]*\\/\\)\\?,,' -e 's/\\.git$//'");
		}
		var lver = shell.exec('git describe --abbrev=0 --tags', {
			silent : true
		});
		if (lver.code !== 0) {
			grunt.log.error(new Error('Error capturing last version'
					+ lver.output));
		}
		lver = lver.code === 0 ? dfltVersionLabel
				+ lver.output.replace(regexLines, '') : '';
		var sls = options.repoSlug ? options.repoSlug.split('/') : [];
		var c = new Commit(cm, lver, options.commitNumber, options.buildDir,
				br, rs, sls.length ? sls[0] : '', sls.length > 1 ? sls[1] : '',
				options.gitToken);
		grunt.config.set(pluginName, c);
		grunt.log.writeflags(c,
				'The following properties are now accessible via grunt.config.get("'
						+ pluginName + '")');
	}

	/**
	 * Basic Commit {Object} that extracts/bumps/sets version numbers
	 * 
	 * @constructor
	 * @param cm
	 *            the commit message to extract the versions from
	 * @param pcm
	 *            an optional commit message from a previous release
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
	function Commit(cm, pcm, cn, pkgPath, buildDir, branch, slug, username,
			reponame, gitToken) {
		var rv = cm ? cm.match(regexRelease) : [];
		if (!rv) {
			rv = [];
		}
		var self = this;
		var vt = 0, si = -1, vlp = '';
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
		this.skips = [];
		this.skipTaskGen = function(task) {
			return task ? '[skip ' + task + ']' : task;
		};
		this.skip = function(task) {
			return self.skips && self.skips.indexOf(task) >= 0;
		};
		if (cm) {
			// extract skip tasks in format: [skip someTask]
			cm.replace(regexSkips, function(m, t, c, s) {
				this.skips.push(t);
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
		this.versionPatch = rv.length > 8 ? verMatchVal(8,
				!this.versionPrereleaseType) : 0;
		this.versionPrerelease = rv.length > 12 ? verMatchVal(12,
				this.versionPrereleaseType) : 0;
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
		this.versionPkg = function(set, revert) {
			var pkg = grunt.file.readJSON(commit.pkg);
			var u = self.pkgPath && set && !revert
					&& pkg.version != self.version;
			var r = self.pkgPath && set && revert && pkg.version != vlp
					&& (!vlp ? vlp = self.versionPkg().pkg.version : vlp);
			if (set && (u || r)) {
				pkg.version = r ? vlp : self.version;
				grunt.file.write(self.pkgPath, JSON.stringify(pkg));
				if (u) {
					vlp = pkg.version;
				}
			}
			return {
				updated : u,
				reverted : r,
				pkg : pkg
			};
		};
		function verMatchVal(i, inc) {
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
	 * @returns the plug-in configuration
	 */
	function get() {
		return grunt.config.get(pluginName);
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
		var errors = new Errors();
		var chgLogRtn = '';
		var doneAsync = null;

		// Capture commit message
		var commit = get();
		if (!commit.version) {
			grunt.log.wrieln('Non-release commit');
			return done();
		}
		grunt.log.writeln('Preparing release: '
				+ commit.version
				+ ' (last release: '
				+ (commit.lastCommit.versionTag ? commit.lastCommit.versionTag
						: 'N/A') + ')');
		if (!validate(commit)) {
			return done();
		}
		return;
		var useGitHub = options.gitHostname.toLowerCase() === gitHubHostname;
		var relMsg = commit.message + ' ' + commit.skipTaskGen('ci');

		// Generate change log for release using all messages since last
		// tag/release
		var chgLogPath = pth.join(options.destDir, options.chgLog);
		var lastGitLog = commit.lastCommit
				&& !commit.lastCommit.versionVacant() ? commit.lastCommit.versionTag
				+ '..HEAD'
				: 'HEAD';
		chgLogRtn = cmd('git --no-pager log ' + lastGitLog
				+ ' --pretty=format:"' + options.chgLogLineFormat + '" > '
				+ chgLogPath, null, false, chgLogPath,
				options.chgLogSkipLineRegExp, '<!-- Commit ' + commit.number
						+ ' -->\n');
		if (options.chgLogRequired && !validateFile(chgLogPath)) {
			return done();
		}

		// Generate list of authors/contributors since last tag/release
		var authorsPath = pth.join(options.destDir, options.authors);
		cmd('git log --all --format="%aN <%aE>" | sort -u > ' + authorsPath,
				null, false, authorsPath, options.authorsSkipLineRegExp);
		if (options.authorsRequired && !validateFile(authorsPath)) {
			return done();
		}

		// Setup
		var link = '${GH_TOKEN}@github.com/' + commit.slug + '.git';
		cmd('git config --global user.email "travis@travis-ci.org"');
		cmd('git config --global user.name "travis"');
		cmd('git remote rm origin');
		cmd('git remote add origin https://' + commit.username + ':' + link);

		if (commit.pkg) {
			// push new package version
			commit.versionPkg(true);
			cmd('git commit -q -m "' + relMsg + '"');
			cmd('git push origin ' + commit.pkgFile);
		}

		// Commit changes to master (needed to generate archive asset)
		cmd('git add --force ' + options.destDir);
		cmd('git commit -q -m "' + relMsg + '"');

		// Create distribution assets
		var distAsset = commit.reponame + '-' + commit.version + '-dist.'
				+ options.distAssetFormat;
		cmd('git archive -o ' + distAsset + ' --format='
				+ options.distAssetFormat + ' -'
				+ options.distAssetCompressRatio + ' HEAD:' + options.destDir);

		// Tag release
		grunt.log.writeln('Releasing ' + commit.versionTag + ' via '
				+ options.gitHostname);
		if (!useGitHub) {
			cmd('git tag -f -a ' + commit.versionTag + ' -m "'
					+ chgLogRtn.replace(regexLines, '$1 \\') + '"');
			cmd('git push -f origin ' + commit.versionTag);
			try {
				// TODO : upload asset?
				publish(function() {
					grunt.log.writeln('Rolling back ' + commit.versionTag
							+ ' release via ' + options.gitHostname);
					// nothing else to perform other than removing the tag
					done(true);
				});
			} catch (e) {
				errors.log('Publish failed!', e);
				return done();
			}
		} else {
			// Release and distribute archive asset for tagged release
			// Need asynchronous processing from this point on
			doneAsync = task.async();
			releaseAndUploadAsset({
				path : distAsset,
				name : distAsset
			}, 'application/zip', commit, chgLogRtn, options, errors, function(
					step, json, rb) {
				try {
					if (errors.count() > 0) {
						errors.log('Failed to ' + step + ' ' + distAsset);
						done();
					} else if (json && json.state != 'uploaded') {
						errors.log(step + ' failed with state: ' + json.state);
						done();
					} else {
						grunt.log.writeln('Distributed/' + json.state + ' '
								+ distAsset + ' asset');
						publish(rb);
					}
				} catch (e) {
					errors.log('Post release failed!', e);
					if (typeof rb === 'function') {
						rb(done);
					} else {
						done();
					}
				}
			});
		}

		/**
		 * When running in asynchronous mode grunt will be notified the process
		 * is complete
		 * 
		 * @param removeTag
		 *            true to indicate that the tag needs to be removed
		 * @returns the return value from grunt when running in asynchronous
		 *          mode, otherwise, the passed value
		 */
		function done(removeTag) {
			if (removeTag) {
				try {
					cmd('git push --delete origin ' + commit.versionTag);
				} catch (e) {
					errors.log('Unable to delete/rollback tag '
							+ commit.versionTag, e);
				}
			}
			if (doneAsync) {
				return doneAsync(errors.count() <= 0);
			} else if (errors.count() > 0) {
				throw new Error('Release failed');
			}
			return true;
		}

		/**
		 * Publish repository web site (commit should have a valid ID)
		 * 
		 * @param rb
		 *            the rollback function to call when the publish fails
		 */
		function publish(rb) {
			try {
				if (!commit.releaseId) {
					grunt.log.writeln('No release ID Skipping publishing to '
							+ options.destBranch);
					return done();
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
					// so
					// that they are not removed by the following steps
					grunt.log.writeln(copyRecursiveSync(destPath, ghPath,
							options.destExcludeDirRegExp,
							options.destExcludeFileRegExp).toString());
					// cmd('cp -r ' + pth.join(destPath, '*') + ' ' + ghPath);
					cmd('git fetch origin ' + options.destBranch);
					cmd('git checkout -q --track origin/' + options.destBranch);
					cmd('git rm -rfq .');
					cmd('git clean -dfq .');
					grunt.log
							.writeln('Copying publication directories/files from '
									+ ghPath + ' to ' + commit.buildDir);
					grunt.log
							.writeln(copyRecursiveSync(ghPath, commit.buildDir)
									.toString());
					// cmd('cp -r ' + pth.join(ghPath, '*') + ' .');
					updatePublishAssets(commit.buildDir);
					cmd('git add -A && git commit -m "' + relMsg + '"');
					cmd('git push -f origin ' + options.destBranch);
				}
				if (commit.pkg) {
					if (typeof commit.npmTarget === 'string') {
						cmd('npm publish ' + commit.npmTarget + ' --tag '
								+ commit.version);
					}
				}
				done();
			} catch (e) {
				if (typeof rb === 'function') {
					errors.log('Publish failed! Rolling back release...', e);
					commit.versionPkg(true, true);
					if (done === rb) {
						done();
					} else {
						rb(done);
					}
				} else {
					var msg = 'Publish failed! '
							+ 'Tagged release will need to be removed manually';
					errors.log(msg, e);
					done();
				}
			} finally {
				try {
					cmd('cd ' + commit.buildDir);
					cmd('git checkout -q ' + commit.branch);
				} catch (e) {
					errors.log('Post publish failed!', e);
				}
			}
		}

		function pushPkg(revert) {
			if (commit.pkg && commit.versionPkg(true, revert)) {
				// push new package version
				;
				cmd('git commit -q -m "' + relMsg + '"');
				cmd('git push origin ' + commit.pkgFile);
			}
		}

		/**
		 * Updates any publishing asset content
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
					for (var i = 0; i < paths.length; i++) {
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
				errors.log('Unable to update publish release asset URL', e);
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
				rtn = shell.exec(c, {
					silent : true
				});
			} else {
				rtn = shell[c.shell].apply(shell, c.args);
			}
			if (rtn.code !== 0) {
				var e = 'Error "' + rtn.code + '" for commit number '
						+ commit.number + ' ' + rtn.output;
				if (nofail) {
					errors.log(e);
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
				errors.log('Failed to find any entries in "' + path
						+ '" (file size: ' + stat.size + ')');
				return false;
			}
			return true;
		}
	}

	function validate(c) {
		c = c || get();
		if (!c.version) {
			return false;
		} else if (regexVerExt.test(c.version)) {
			if (!c.lastCommit.versionTag) {
				throw grunt.util.error('No prior tagged version found! '
						+ c.versionTag
						+ ' not valid for increments and/or extractions');
			}
			// versionLabel : v[0],
			// versionType : v[1],
			// version : v[2],
			// versionTag : v[3],
			// versionMajor : v[4],
			// versionMinor : v[5],
			// versionPatch : v[6],
			// versionPrereleaseType : v[7],
			// versionPrerelease : v[8],
		} else if (c.lastVersionTag) {

		}
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
	 * @param errors
	 *            the {Errors} instance
	 * @param cb
	 *            the call back function (passed parameters: the current task,
	 *            JSON response, error)
	 */
	function releaseAndUploadAsset(asset, contentType, commit, desc, options,
			errors, cb) {
		var step = 'release';
		var authToken = commit.gitToken();
		if (!authToken) {
			cbi(null, grunt.util.error('Invalid authorization token'));
			return;
		}
		var data = '', data2 = '', rl = null, cf = null, called = false;
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
		// post new tag/release
		var req = https.request(opts, function(res) {
			var sc = res.statusCode;
			res.on('data', function(chunk) {
				data += chunk;
			});
			res.on('end', function() {
				try {
					var success = gitHubSuccessHttpCodes
							.indexOf(res.statusCode) >= 0;
					rl = success ? chk(JSON
							.parse(data.replace(regexLines, ' '))) : null;
					if (rl && rl[gitHubReleaseTagName] == commit.versionTag) {
						commit.releaseId = rl[gitHubReleaseId];
						if (fstat.size <= 0) {
							cbi();
							return;
						}
						grunt.log.writeln('Uploading "' + asset.path
								+ '" release asset for ' + commit.versionTag
								+ ' via ' + options.gitHostname);
						step = 'upload asset';
						opts.method = 'POST';
						opts.path = rl[gitHubReleaseUploadUrl].replace(
								regexHost, function(m, h) {
									opts.hostname = h;
									return '/';
								});
						opts.path = opts.path.replace(gitHubRegexParam, '$1='
								+ (asset.name || commit.versionTag));
						opts.headers['Content-Type'] = contentType;
						opts.headers['Content-Length'] = fstat.size;
						var req2 = https.request(opts, function(res2) {
							res2.on('data', function(chunk) {
								grunt.log.writeln('Receiving chunked data');
								data2 += chunk;
							});
							res2.on('end', function() {
								try {
									var success = gitHubSuccessHttpCodes
											.indexOf(res2.statusCode) >= 0;
									if (success) {
										cf = chk(JSON.parse(data2.replace(
												regexLines, ' ')));
										grunt.log.writeln('Asset ID '
												+ cf[gitHubReleaseAssetId]
												+ ' successfully uploaded');
										setCommitAsset(cf);
									} else {
										errors.log('Asset upload failed!',
												data2);
									}
									try {
										cbi();
									} catch (e) {
										// prevent
										// cyclic
										// error
										errors.log(e);
									}
								} catch (e) {
									cbi('Received response:', data2, e);
								}
							});
							grunt.log.writeln('Waiting for response');
						});
						req2.on('error', function(e) {
							cbi('Received error response', e);
						});
						// stream asset to
						// remote host
						fs.createReadStream(asset.path, {
							'bufferSize' : 64 * 1024
						}).pipe(req2);
					} else {
						cbi('No tag found for ' + commit.versionTag + ' in '
								+ tags.join(',') + ' HTTP Status: '
								+ res.statusCode + ' Response: \n' + data);
					}
				} catch (e) {
					cbi(e);
				}
			});
		});
		req.end(json);
		req.on('error', function(e) {
			cbi(e);
		});

		/**
		 * Handles callback once the release and asset upload completes or an
		 * error occurs during the process. When one or more error(s) are
		 * present and a prior tagged release has taken place, an attempt is
		 * made to rollback the release by removing the tagged release via the
		 * external GitHub API. Optional error(s) can be passed to be logged.
		 */
		function cbi() {
			var o = null;
			try {
				if (called) {
					return;
				}
				// log any errors that are passed
				if (arguments.length) {
					errors.log(arguments);
				}
				o = cf || rl;
				cb(step, o, rbcb);
			} catch (e) {
				errors.log('Failed to call release completion callback', e);
			}
			called = true;

			/**
			 * Rollback callback
			 * 
			 * @param fx
			 *            the callback function that will be called when the
			 *            rollback completes- will receive boolean indicating if
			 *            the rollback was a success, the last step taken before
			 *            the rollback (e.g. release, asset upload, etc.) and
			 *            the last received object from the external API.
			 */
			function rbcb(fx) {
				try {
					// rollback release
					opts.path = pth.join(releasePath, commit.releaseId
							.toString());
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
						res.on('end', function() {
							var success = gitHubSuccessHttpCodes
									.indexOf(res.statusCode) >= 0;
							var msg = 'Rollback '
									+ (success ? 'complete' : 'ERROR')
									+ ' for release ID: ' + commit.releaseId;
							if (success) {
								grunt.log.writeln(msg);
								grunt.log.writeln(rrdata);
							} else {
								errors.log(msg, rrdata);
							}
							fx(true, step, o);
						});
					});
					rreq.end();
					rreq.on('error', function(e) {
						errors.log('Failed to rollback release ID '
								+ commit.releaseId, e);
						fx(false, step, o);
					});
				} catch (e) {
					errors.log('Failed to request rollback for release ID '
							+ commit.releaseId, e);
					fx(false, step, o);
				}
			}
		}

		/**
		 * Sets commit asset details on the commit object
		 * 
		 * @param cf
		 *            the JSON object returned from the asset upload process
		 */
		function setCommitAsset(cf) {
			if (!cf) {
				return;
			}
			commit.releaseAsset = cf;
			commit.releaseAssetUrl = 'https://' + options.gitHostname + '.com/'
					+ commit.username + '/' + commit.reponame
					+ '/releases/download/' + commit.versionTag + '/'
					+ cf[gitHubReleaseName];
		}
	}

	/**
	 * Error tracking
	 * 
	 * @constructor
	 */
	function Errors() {
		var errors = [];

		/**
		 * Logs one or more errors (can be {Error}, {Object} or {String})
		 */
		this.log = function() {
			for (var i = 0; i < arguments.length; i++) {
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