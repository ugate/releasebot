'use strict';

var shell = require('shelljs');
var semver = require('semver');
var npm = require("npm");
var fs = require('fs');
var pth = require('path');
var util = require('util');
var pluginName = 'releasebot';
var configEnv = pluginName + '.env';
var configCommit = pluginName + '.commit';
var dfltVersionLabel = 'Release';
var dfltVersionType = 'v';
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
var regexFuncName = /(?!\W*function\s+)[\w\$]+(?=\()/;
var regexHost = /^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i;
var regexKeyVal = /="(.+)"$/;
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

	// initialize global release environment options
	var commit = initEnv({
		pkgPath : grunt.config('pkgFile') || 'package.json',
		gitCliSubstitute : '',
		buildDir : process.env.TRAVIS_BUILD_DIR || process.cwd(),
		branch : process.env.TRAVIS_BRANCH,
		commitHash : process.env.TRAVIS_COMMIT,
		commitMessage : process.env.TRAVIS_COMMIT_MESSAGE,
		repoSlug : process.env.TRAVIS_REPO_SLUG,
		lastVersionMsgIgnoreRegExp : /No names found/i,
		gitToken : process.env.GH_TOKEN,
		npmToken : process.env.NPM_TOKEN
	});

	// register release task
	grunt.registerTask(pluginName, pluginDesc, function() {
		var rx = regexRelease;
		var em = pluginName
				+ '@'
				+ (process.env.TRAVIS_BUILD_NUMBER ? 'travis-ci.org'
						: 'example.org');
		var options = this.options({
			name : '<%= commit.versionTag %>',
			pkgJsonReplacer : null,
			pkgJsonSpace : 2,
			releaseVersionRegExp : rx,
			gitHostname : gitHubHostname,
			repoName : 'origin',
			repoUser : pluginName,
			repoEmail : em,
			chgLog : 'HISTORY.md',
			authors : 'AUTHORS.md',
			chgLogLineFormat : '  * %s',
			chgLogRequired : true,
			chgLogSkipLineRegExp : new RegExp('.*(?:(?:' + rx.source + ')|('
					+ regexSkipChgLog.source + ')|(Merge\\sbranch\\s\''
					+ commit.branch + '\')).*\r?\n', 'g'
					+ (rx.multiline ? 'm' : '') + (rx.ignoreCase ? 'i' : '')),
			authorsRequired : false,
			authorsSkipLineRegExp : null,
			distBranch : 'gh-pages',
			distDir : 'dist',
			distBranchCreateRegExp : /Couldn't find remote ref/i,
			distExcludeDirRegExp : /.?node_modules.?/gmi,
			distExcludeFileRegExp : /.?\.zip|tar.?/gmi,
			distAssetCompressRatio : 9,
			distAssetDir : '..',
			distAssetUpdateFunction : null,
			distAssetUpdateFiles : [],
			distBranchUpdateFunction : null,
			distBranchUpdateFiles : [],
			rollbackStrategy : 'queue',
			releaseSkipTasks : [ 'ci' ],
			asyncTimeout : 60000,
			npmTag : ''
		});
		if (options.gitHostname === gitHubHostname && commit.username) {
			options.hideTokenRegExp = new RegExp('(' + commit.username
					+ ':)([0-9a-f]+)(@' + options.gitHostname + ')');
		}
		release(this, options);
	});

	/**
	 * Initializes the global environment and returns {Commit} related data
	 * 
	 * @param env
	 *            the environment object
	 * @returns {Commit}
	 */
	function initEnv(env) {
		var gconfig = grunt.config.get(configEnv) || {};
		var nargv = null;
		// find via node node CLI argument in the format key="value"
		function argv(k) {
			if (!nargv) {
				nargv = process.argv.slice(0, 2);
			}
			var v = '', m = null;
			var x = new RegExp(k + regexKeyVal.source);
			nargv.every(function(e) {
				m = e.match(x);
				if (m && m.length) {
					v = m[0];
					return false;
				}
			});
			return v;
		}
		function getv(k) {
			return gconfig[k] || grunt.option(pluginName + '.' + k)
					|| argv(pluginName + '.' + k) || '';
		}
		function token(tkn) {
			return typeof tkn === 'function' ? tkn : function() {
				return tkn;
			};
		}
		// loop through and set the values
		var tk = /token$/i;
		Object.keys(env).forEach(function(key) {
			if (!env[key]) {
				env[key] = getv(key);
			}
			// use function to prevent accidental log leaking of tokens
			if (env[key] && tk.test(key)) {
				env[key] = token(env[key]);
			}
		});
		return genCommit(env);
	}

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
		var ch = env.commitHash;
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
		function sur(s) {
			var ss = s.split('/');
			un = ss[0];
			rn = ss[1];
			rs = s;
		}
		if (!br) {
			br = cmd('git rev-parse --abbrev-ref HEAD');
			grunt.verbose.writeln('Found branch: "' + br + '"');
		}
		if (!ch) {
			ch = cmd('git rev-parse HEAD');
			grunt.verbose.writeln('Found commit hash: "' + ch + '"');
		}
		if (!cm) {
			// fall back on either last commit message or the commit message for
			// the current commit hash
			cm = cmd("git show -s --format=%B " + env.commitHash);
			grunt.verbose.writeln('Found commit message: "' + cm + '"');
		}
		if (!rs) {
			// fall back on capturing the repository slug from the current
			// remote
			rs = cmd("git ls-remote --get-url");
			rs.replace(regexSlug, function(m, s) {
				sur(s);
				rs = s;
			});
		} else {
			sur(rs);
		}
		if (rs) {
			grunt.verbose.writeln('Found repo slug: "' + rs + '"');
		}
		var lver = execCmd('git describe --abbrev=0 --tags',
				env.gitCliSubstitute);
		var lverno = false;
		if (lver.code !== 0
				&& (!util.isRegExp(env.lastVersionMsgIgnoreRegExp) || !(lverno = env.lastVersionMsgIgnoreRegExp
						.test(lver.output)))) {
			throw new Error('Error capturing last version ' + lver.output);
		}
		if (!lverno && lver.output) {
			lver = lver.output.replace(regexLines, '');
			grunt.log.writeln('Found last release version "' + lver
					+ '" from git');
		} else {
			lver = '';
			var pkg = grunt.file.readJSON(env.pkgPath);
			if (pkg.version) {
				lver = dfltVersionType + pkg.version;
				grunt.log.writeln('Found last release version "' + lver
						+ '" from ' + env.pkgPath);
			}
		}
		lver = lver ? dfltVersionLabel + ' ' + lver : '';
		var c = new Commit(cm, lver, env.gitCliSubstitute, ch, env.pkgPath,
				env.buildDir, br, rs, un, rn, env.gitToken, env.npmToken);
		cloneAndSetCommit(c);
		return c;
	}

	/**
	 * Clones a {Commit} and sets the cloned value in the Grunt configuration
	 * 
	 * @param c
	 *            the {Commit} to clone
	 * @param msg
	 *            alternative verbose message (null prevents log output)
	 */
	function cloneAndSetCommit(c, msg) {
		var ic = [ c.skipTaskCheck, c.skipTaskGen, c.versionPkg ];
		var ex = [ c.versionMatch, c.gitCliSubstitute, c.pkgPath, undefined ];
		if (c.lastCommit.versionMatch) {
			ex.push(c.lastCommit.versionMatch);
		}
		var cc = clone(c, ic, ex);
		grunt.config.set(configCommit, cc);
		msg = typeof msg === 'string' ? msg + '\n'
				: typeof msg === 'undefined' ? 'The following read-only object is now accessible via grunt.config.get("'
						+ configCommit + '"):\n'
						: msg;
		if (msg) {
			grunt.verbose.writeln(msg + util.inspect(cc, {
				colors : true,
				depth : 3
			}));
			// grunt.log.writeflags(c, msg);
		}
	}

	/**
	 * Clones an object
	 * 
	 * @param c
	 *            the {Commit} to clone
	 * @param wl
	 *            an array of white list functions that will be included in the
	 *            clone (null to include all)
	 * @param bl
	 *            an array of black list property values that will be excluded
	 *            from the clone
	 * @returns {Object} clone
	 */
	function clone(c, wl, bl) {
		var cl = {}, cp, t;
		for ( var keys = Object.keys(c), l = 0; l < keys.length; l++) {
			cp = c[keys[l]];
			if (bl && bl.indexOf(cp) >= 0) {
				continue;
			}
			if (Array.isArray(cp)) {
				cl[keys[l]] = cp.slice(0);
			} else if ((t = typeof cp) === 'function') {
				if (!wl || wl.indexOf(cp) >= 0) {
					cl[keys[l]] = cp; // cp.bind(cp);
				}
			} else if (cp == null || t === 'string' || t === 'number'
					|| t === 'boolean' || util.isRegExp(cp) || util.isDate(cp)
					|| util.isError(cp)) {
				cl[keys[l]] = cp;
			} else if (t !== 'undefined') {
				cl[keys[l]] = clone(cp, wl, bl);
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
	 *            the commit hash
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
	 * @param npmToken
	 *            a function that will be used to extract the npm token
	 */
	function Commit(cm, pcm, gitCliSubstitute, ch, pkgPath, buildDir, branch,
			slug, username, reponame, gitToken, npmToken) {
		var rv = cm ? cm.match(regexRelease) : [];
		if (!rv) {
			rv = [];
		}
		var self = this;
		var vt = 0, si = -1;
		this.gitCliSubstitute = gitCliSubstitute;
		this.pkgPath = pkgPath;
		this.hash = ch;
		this.buildDir = buildDir;
		this.branch = branch;
		this.slug = slug;
		this.username = username;
		this.reponame = reponame;
		this.gitToken = gitToken || '';
		this.npmToken = npmToken || '';
		this.releaseId = null;
		this.releaseAssets = [];
		this.skipTasks = [];
		this.skipTaskGen = function() {
			var s = '';
			for ( var i = 0; i < arguments.length; i++) {
				if (Array.isArray(arguments[i])) {
					s += self.skipTaskGen.apply(self, arguments[i]);
				} else if (arguments[i]) {
					s += '[skip ' + arguments[i] + ']';
				}
			}
			return s;
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
		this.hasGitToken = typeof gitToken === 'function' ? gitToken().length > 0
				: typeof gitToken === 'string' && gitToken.length > 0;
		this.hasNpmToken = typeof npmToken === 'function' ? npmToken().length > 0
				: typeof npmToken === 'string' && npmToken.length > 0;
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
		this.versionPkg = function(replacer, space, revert, altWrite, cb,
				altPath) {
			var pkg = null;
			var pth = altPath || self.pkgPath;
			if (pth) {
				pkg = grunt.file.readJSON(pth);
				var u = pkg && !revert && pkg.version !== self.version
						&& self.version;
				var r = pkg && revert && self.lastCommit.version;
				if (u || r) {
					var oldVer = pkg.version;
					pkg.version = r ? self.lastCommit.version || '0.0.0'
							: self.version;
					var pkgStr = JSON.stringify(pkg, replacer, space);
					grunt.file.write(pth,
							typeof altWrite === 'function' ? altWrite(pkg,
									pkgStr, oldVer, u, r, pth, replacer, space)
									: pkgStr);
					if (typeof cb === 'function') {
						cb(pkg, pkgStr, oldVer, u, r, pth, replacer, space);
					}
				}
			}
			return pkg;
		};
		this.versionValidate = function() {
			if (!validate(self.version)) {
				return false;
			} else if (self.lastCommit.version
					&& semver.lte(self.version, self.lastCommit.version)) {
				throw grunt.util.error(self.version
						+ ' must be higher than the last release version '
						+ self.lastCommit.version);
			}
			return true;
		};
		function validate(v, q) {
			if (!v) {
				if (!q) {
					grunt.verbose.writeln('Non-release commit ' + (v || ''));
				}
				return false;
			} else if (!self.hasGitToken) {
				throw grunt.util.error('No Git token found, version: ' + v);
			} else if (!semver.valid(v)) {
				throw grunt.util.error('Invalid release version: ' + v);
			}
			return true;
		}
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
		if (!commit.versionValidate()) {
			return;
		}
		grunt.log.writeln('Preparing release: '
				+ commit.version
				+ ' (last release: '
				+ (commit.lastCommit.versionTag ? commit.lastCommit.versionTag
						: 'N/A') + ')');
		var useGitHub = options.gitHostname.toLowerCase() === gitHubHostname;
		var relMsg = commit.message + ' '
				+ commit.skipTaskGen(options.releaseSkipTasks);
		var releaseName = grunt.template.process(options.name, {
			data : {
				commit : commit,
				options : options
			}
		});
		var chgLogRtn = '', pubSrcDir = '', pubDistDir = '', pubHash = '', pckBumped = false;
		var distZipAsset = '', distTarAsset = '', distZipAssetName = '', distTarAssetName = '';

		// Queue/Start work
		var que = new Queue(options).add(remoteSetup).add(pkgUpdate).add(
				changeLog).add(authorsLog);
		que.add(addAndCommitDistDir).add(genDistAssets);
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
			try {
				cloneAndSetCommit(commit, null);
			} catch (e) {
				que.error('Failed to set global commit result properties', e);
			}
			var msg = que.errorCount() > 0 ? 'Processed ' + rbcnt
					+ ' rollback action(s)' : 'Released ' + commit.versionTag;
			grunt.log.writeln(msg);
			if (doneAsync) {
				doneAsync(que.errorCount() <= 0);
			} else if (que.errorCount() > 0) {
				throw new Error('Release failed');
			}
		});

		/**
		 * Remote Git setup to permit pushes
		 */
		function remoteSetup() {
			var link = '${GH_TOKEN}@github.com/' + commit.slug + '.git';
			cmd('git config --global user.email "' + options.repoEmail + '"');
			cmd('git config --global user.name "' + options.repoUser + '"');
			cmd('git remote rm ' + options.repoName);
			cmd('git remote add ' + options.repoName + ' https://'
					+ commit.username + ':' + link);
		}

		/**
		 * Updates the package file version using the current {Commit} version
		 * and commits/pushes it to remote
		 */
		function pkgUpdate(altPkgPath, noPush) {
			chkoutRun(commit.branch, upkg);
			que.addRollback(function() {
				chkoutRun(commit.branch, upkg, true);
			});
			function upkg(revert) {
				commit.versionPkg(options.pkgJsonReplacer,
						options.pkgJsonSpace, revert, pkgWritable, pkgPush,
						altPkgPath);
			}
			function pkgWritable(pkg, pkgStr, ov, u, r, p) {
				pkgLog(pkg, pkgStr, ov, u, r, p, true);
				return pkgStr;
			}
			function pkgPush(pkg, pkgStr, ov, u, r, p) {
				// TODO : check to make sure there isn't any commits ahead of
				// this one
				if (!noPush) {
					cmd('git commit -q -m "' + relMsg + '" ' + p);
					cmd('git push ' + options.repoName + ' ' + commit.branch);
					pckBumped = u;
				}
				pkgLog(pkg, pkgStr, ov, u, r, p, false);
			}
			function pkgLog(pkg, pkgStr, ov, u, r, p, beforeWrite) {
				var m = (r ? 'Revert' : 'Bump') + (beforeWrite ? 'ing' : 'ed')
						+ ' version from ' + ov + ' to ' + pkg.version + ' in '
						+ p;
				if (r) {
					grunt.verbose.writeln(m);
				} else {
					grunt.log.writeln(m);
				}
			}
		}

		/**
		 * Generates/Writes a change log for the current release using all
		 * messages since last tag/release
		 */
		function changeLog() {
			// Generate change log for release using all messages since last
			// tag/release
			if (!options.chgLog) {
				if (options.chgLogRequired) {
					throw new Error('Invalid "options.chgLog": "'
							+ options.chgLog + '" ("options.chgLogRequired": '
							+ options.chgLogRequired + '"');
				}
				return;
			}
			var chgLogPath = options.distDir + '/' + options.chgLog;
			var lastGitLog = commit.lastCommit
					&& !commit.lastCommit.versionVacant() ? commit.lastCommit.versionTag
					+ '..HEAD'
					: 'HEAD';
			chgLogRtn = cmd('git --no-pager log ' + lastGitLog
					+ ' --pretty=format:"' + options.chgLogLineFormat + '" > '
					+ chgLogPath, null, false, chgLogPath,
					options.chgLogSkipLineRegExp, '<!-- Commit ' + commit.hash
							+ ' -->\n')
					|| '';
			validateFile(chgLogPath);
		}

		/**
		 * Generates/Writes an authors log for the current release using all
		 * authors since last tag/release
		 */
		function authorsLog() {
			// Generate list of authors/contributors since last tag/release
			if (!options.authors) {
				if (options.authorsRequired) {
					throw new Error('Invalid "options.authors": "'
							+ options.authors
							+ '" ("options.authorsRequired": '
							+ options.authorsRequired + '"');
				}
				return;
			}
			var authorsPath = options.distDir + '/' + options.authors;
			cmd('git --no-pager shortlog -sen HEAD > ' + authorsPath, null,
					false, authorsPath, options.authorsSkipLineRegExp);
			validateFile(authorsPath);
		}

		/**
		 * Adds/Commits everything in the distribution directory for tracking
		 */
		function addAndCommitDistDir() {
			if (commit.pkgPath && commit.distDir
					&& !/\.|\//.test(commit.distDir)) {
				// need to update the package included in the distribution
				pkgUpdate(pth.join(commit.distDir, commit.pkgPath), true);
			}
			// Commit changes (needed to generate archive asset)
			cmd('git add --force ' + options.distDir);
			cmd('git commit -q -m "' + relMsg + '"');
		}

		/**
		 * Generates distribution archive assets (i.e. zip/tar)
		 */
		function genDistAssets() {
			// give taskateers a chance to update branch file contents
			updateFiles(options.distAssetUpdateFiles,
					options.distAssetUpdateFunction, commit.buildDir);
			// Create distribution assets
			distZipAssetName = commit.reponame + '-' + commit.version
					+ '-dist.zip';
			distZipAsset = pth.resolve(options.distAssetDir, distZipAssetName);
			cmd('git archive -o "' + distZipAsset + '" --format=zip -'
					+ options.distAssetCompressRatio + ' HEAD:'
					+ options.distDir);
			if (grunt.option('verbose')) {
				grunt.verbose.writeln('Created ' + distZipAsset + ' (size: '
						+ fs.statSync(distZipAsset).size + ')');
			}
			distTarAssetName = commit.reponame + '-' + commit.version
					+ '-dist.tar.gz';
			distTarAsset = pth.resolve(options.distAssetDir, distTarAssetName);
			cmd('git archive -o "' + distTarAsset + '" --format=tar.gz HEAD:'
					+ options.distDir);
			if (grunt.option('verbose')) {
				grunt.verbose.writeln('Created ' + distTarAsset + ' (size: '
						+ fs.statSync(distTarAsset).size + ')');
			}
		}

		/**
		 * Tags release via standard Git CLI
		 */
		function gitRelease() {
			// Tag release
			grunt.log.writeln('Tagging release ' + commit.versionTag + ' via '
					+ options.gitHostname);
			cmd('git tag -f -a '
					+ commit.versionTag
					+ ' -m "'
					+ (chgLogRtn ? chgLogRtn.replace(regexLines, '$1 \\')
							: commit.message) + '"');
			cmd('git push -f ' + options.repoName + ' ' + commit.versionTag);
			// TODO : upload asset?
			que.addRollback(rollbackTag);
			que.add(publish);
		}

		/**
		 * Calls the GitHub Release API to tag release and upload optional
		 * distribution asset
		 */
		function gitHubRelease() {
			grunt.log.writeln('Releasing ' + commit.versionTag + ' via '
					+ options.gitHostname);
			// GitHub Release API will not remove the tag when removing a
			// release
			releaseAndUploadAsset([ {
				path : distZipAsset,
				name : distZipAssetName,
				contentType : 'application/zip'
			}, {
				path : distTarAsset,
				name : distTarAssetName,
				contentType : 'application/x-compressed'
			} ], commit, releaseName, chgLogRtn || commit.message, options,
					que, rollbackTag, function() {
						que.add(publish);
					});
		}

		/**
		 * Publish repository pages to distribution branch (commit should have a
		 * valid ID)
		 */
		function publish() {
			if (!commit.releaseId) {
				grunt.log.writeln('No release ID Skipping publishing to '
						+ options.distBranch);
			} else if (!options.distBranch) {
				grunt.verbose.writeln('Skipping publishing distribution');
			} else {
				grunt.log.writeln('Publishing to ' + options.distBranch);
				pubSrcDir = pth.join(commit.buildDir, options.distDir);
				pubDistDir = commit.buildDir.replace(commit.reponame,
						options.distBranch);
				grunt.log.writeln('Copying publication directories/files from '
						+ pubSrcDir + ' to ' + pubDistDir);
				// copy all directories/files over that need to be published
				// so that they are not removed by the following steps
				grunt.log.writeln(copyRecursiveSync(pubSrcDir, pubDistDir,
						options.distExcludeDirRegExp,
						options.distExcludeFileRegExp).toString());
				// cmd('cp -r ' + pth.join(pubSrcDir, '*') + ' ' + pubDistDir);
				chkoutRun(
						null,
						function() {
							try {
								cmd('git fetch ' + options.repoName + ' '
										+ options.distBranch);
								pubHash = cmd('git rev-parse HEAD');
							} catch (e) {
								if (util
										.isRegExp(options.distBranchCreateRegExp)
										&& options.distBranchCreateRegExp
												.test(e.message)) {
									cmd('git checkout -q --orphan '
											+ options.distBranch);
								} else {
									throw e;
								}
							}
							if (pubHash) {
								cmd('git checkout -q --track '
										+ options.repoName + '/'
										+ options.distBranch);
							}
							cmd('git rm -rfq .');
							cmd('git clean -dfq .');
							grunt.log
									.writeln('Copying publication directories/files from '
											+ pubDistDir
											+ ' to '
											+ commit.buildDir);
							grunt.log.writeln(copyRecursiveSync(pubDistDir,
									commit.buildDir).toString());
							// cmd('cp -r ' + pth.join(pubDistDir, '*') + ' .');

							// give taskateers a chance to update branch file
							// contents
							updateFiles(options.distBranchUpdateFiles,
									options.distBranchUpdateFunction,
									commit.buildDir);

							cmd('git add -A');
							cmd('git commit -q -m "' + relMsg + '"');
							cmd('git push -f ' + options.repoName + ' '
									+ options.distBranch);

							que.addRollback(rollbackPublish);
							que.add(publishNpm);
						});
			}
		}

		/**
		 * npm publish
		 */
		function publishNpm() {
			var pkg = null, auth = [];
			if (commit.hasNpmToken && commit.pkgPath && pckBumped) {
				grunt.log.writeln('Publishing to npm');
			} else {
				grunt.verbose.writeln('Skipping npm publish'
						+ (pckBumped ? '' : ' ' + commit.pkgPath
								+ ' not bumped to ' + commit.version));
			}
			function go() {
				pkg = grunt.file.readJSON(commit.pkgPath);
				if (!pkg || !pkg.author || !pkg.author.email) {
					que
							.error('npm publish failed due to missing author.email in '
									+ commit.pkgPath);
				} else {
					auth = (typeof commit.npmToken === 'function' ? commit
							.npmToken() : commit.npmToken);
					auth = typeof auth === 'string'
							&& (auth = new Buffer(auth, 'base64').toString()) ? auth
							.split(':')
							: [];
					if (auth.length !== 2) {
						que.error('npm NPM_TOKEN is missing or invalid');
					} else {
						que.pause();
						npm.load({}, adduser);
					}
				}
			}
			function adduser(e) {
				if (e) {
					que.error('npm load failed', e).resume();
				} else {
					npm.config.set('email', pkg.author.email, 'user');
					npm.registry.adduser(auth[0], auth[1], pkg.author.email,
							pub);
				}
			}
			function pub(e) {
				if (e) {
					que.error('npm publish failed to be authenticated', e)
							.resume();
				} else {
					var pargs = [];
					if (options.npmTag) {
						pargs.push('--tag ' + options.npmTag);
					}
					grunt.log.writeln('npm publish ' + pargs.join(' '));
					// switch to the master branch so publish will pickup the
					// right version
					chkoutCmd(commit.branch);
					npm.commands.publish(pargs, function(e) {
						chkoutRun(null, function() {
							if (e) {
								que.error('npm publish failed', e).resume();
							} else {
								grunt.verbose.writeln('npm publish complete');
								que.resume();
							}
						});
					});
				}
			}
		}

		/**
		 * Deletes tag using Git CLI
		 */
		function rollbackTag() {
			cmd('git push --delete ' + options.repoName + ' '
					+ commit.versionTag);
		}

		/**
		 * Reverts published branch
		 */
		function rollbackPublish() {
			try {
				chkoutRun(options.distBranch, function() {
					var cph = cmd('git rev-parse HEAD');
					if (pubHash && pubHash !== cph) {
						cmd('git checkout -qf ' + pubHash);
						cmd('git commit -q -m "Rollback ' + relMsg + '"');
						cmd('git push -f ' + options.repoName + ' '
								+ options.distBranch);
					} else if (!pubHash) {
						cmd('git push ' + options.repoName + ' --delete '
								+ options.distBranch);
					} else {
						grunt.verbose.writeln('Skipping rollback for '
								+ options.distBranch + ' for hash "' + pubHash
								+ '" (current hash: "' + cph + '")');
					}
				});
			} catch (e) {
				var msg = 'Failed to rollback publish branch changes!';
				que.error(msg, e);
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
		 * @returns {String} command output
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
				var e = 'Error "' + rtn.code + '" for commit hash '
						+ commit.hash + ' ' + rtn.output;
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
			return output || '';
		}

		/**
		 * Updates file contents using a spcified function
		 * 
		 * @param files
		 *            the {Array} of files to read/write
		 * @param func
		 *            the function to call for the read/write operation
		 * @param path
		 *            the base path to that will be used to prefix each file
		 *            used in the update process
		 * @returns {String} the replaced URL (undefined if nothing was
		 *          replaced)
		 */
		function updateFiles(files, func, path) {
			try {
				if (Array.isArray(files) && typeof func === 'function') {
					for ( var i = 0; i < files.length; i++) {
						var p = pth.join(path, files[i]), au = '';
						var content = grunt.file.read(p, {
							encoding : grunt.file.defaultEncoding
						});
						var ec = func(content, p, commit);
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
		 * Wraps an optional function with a finally block that will checkout
		 * the current commit after execution. All passed arguments will be
		 * passed (besides the arguments passed into this function) and returned
		 * 
		 * @param chkout
		 *            an optional options appended to a Git checkout command
		 *            that will be executed prior to executing the specified
		 *            function
		 * @param fx
		 *            optional function that will be wrapped with a finally
		 *            block that will checkout the current commit
		 * @returns the return value from the passed function
		 */
		function chkoutRun(chkout, fx) {
			try {
				if (chkout) {
					chkoutCmd(chkout);
				}
				if (typeof fx === 'function') {
					return fx.apply(que, Array.prototype.slice.call(arguments,
							2));
				}
			} finally {
				chkoutCmd();
			}
		}

		/**
		 * Git checkout for the commit (or alt)
		 * 
		 * @param alt
		 *            the string to append to the checkout command
		 */
		function chkoutCmd(alt) {
			cmd('git checkout -q ' + (alt || commit.hash || commit.branch));
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
				// grunt.verbose.writeln('Copied "' + src + '" to "' + dest +
				// '"');
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
	 * @param assets
	 *            an {Array} of objects each containing a <code>path</code>,
	 *            <code>contentType</code> and <code>name</code> of an asset
	 *            to be uploaded (optional)
	 * @param commit
	 *            the commit object the asset is for
	 * @param name
	 *            of release
	 * @param desc
	 *            release description (can be in markdown)
	 * @param options
	 *            the task options
	 * @param que
	 *            the {Queue} instance
	 * @param fcb
	 *            the call back function that will be called when the release
	 *            fails
	 * @param cb
	 *            the call back function called when completed successfully
	 */
	function releaseAndUploadAsset(assets, commit, name, desc, options, que,
			fcb, cb) {
		var authToken = typeof commit.gitToken === 'function' ? commit
				.gitToken() : commit.gitToken;
		if (!authToken) {
			que.error('Invalid authorization token').add(cb);
			return;
		}
		var rl = null;
		// check if API responded with an error message
		function chk(o) {
			if (o[gitHubReleaseErrorMsg]) {
				throw grunt.util.error(JSON.stringify(o));
			}
			return o;
		}
		var assetIndex = -1;
		var asset = nextAsset();
		function nextAsset() {
			assetIndex++;
			var a = {
				item : Array.isArray(assets) && assetIndex < assets.length ? assets[assetIndex]
						: null
			};
			a.size = a.item && a.item.path ? fs.statSync(a.item.path).size : 0;
			a.cb = !a.item || a.size <= 0 ? cb : postReleaseAsset;
			return a;
		}
		var json = {};
		json[gitHubReleaseTagName] = commit.versionTag;
		json[gitHubReleaseName] = name || commit.versionTag;
		json[gitHubReleaseBody] = desc;
		json[gitHubReleaseCommitish] = commit.hash;
		json[gitHubReleasePreFlag] = commit.versionPrereleaseType != null;
		var jsonStr = JSON.stringify(json);
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
			'Content-Length' : jsonStr.length
		};

		// queue request
		que.add(postRelease);

		function postRelease() {
			// pause and wait for response
			que.pause();
			grunt.log.writeln('Posting the following to ' + opts.hostname
					+ releasePath);
			if (grunt.option('verbose')) {
				grunt.verbose.writeln(util.inspect(json, {
					colors : true
				}));
			}
			var resData = '';
			var res = null;
			var req = https.request(opts, function(r) {
				// var sc = res.statusCode;
				res = r;
				res.on('data', function(chunk) {
					resData += chunk;
					grunt.verbose
							.writeln('Receiving post release chunked data');
				});
				res.on('end', function() {
					if (gitHubSuccessHttpCodes.indexOf(res.statusCode) >= 0) {
						grunt.verbose.writeln('Received post release data');
						que.add(postReleaseEnd).resume();
					} else {
						que.error(
								'Release post failed with HTTP status: '
										+ res.statusCode + ' data: '
										+ util.inspect(resData)).add(cb)
								.resume();
					}
				});
			});
			req.end(jsonStr);
			req.on('error', function(e) {
				que.error('Release post failed', e).add(cb).resume();
			});
			function postReleaseEnd() {
				var success = gitHubSuccessHttpCodes.indexOf(res.statusCode) >= 0;
				rl = success ? chk(JSON.parse(resData.replace(regexLines, ' ')))
						: null;
				if (grunt.option('verbose')) {
					grunt.verbose.writeln(util.inspect(rl, {
						colors : true
					}));
				}
				if (rl && rl[gitHubReleaseTagName] === commit.versionTag) {
					commit.releaseId = rl[gitHubReleaseId];
					// queue asset uploaded or complete with callback
					que.addRollbacks(postReleaseRollback, fcb);
					que.add(asset.cb);
				} else {
					que.error(
							'No tag found for ' + commit.versionTag + ' in '
									+ util.inspect(rl, {
										colors : true
									}) + ' HTTP Status: ' + res.statusCode
									+ ' Response: \n' + resData).add(cb);
				}
			}
		}

		function postReleaseAsset() {
			// pause and wait for response
			que.pause();
			grunt.log.writeln('Uploading "' + asset.item.path
					+ '" release asset for ' + commit.versionTag + ' via '
					+ options.gitHostname);
			opts.method = 'POST';
			opts.path = rl[gitHubReleaseUploadUrl].replace(regexHost, function(
					m, h) {
				opts.hostname = h;
				return '/';
			});
			opts.path = opts.path.replace(gitHubRegexParam, '$1='
					+ (asset.item.name || commit.versionTag));
			opts.headers['Content-Type'] = asset.item.contentType;
			opts.headers['Content-Length'] = asset.size;
			var resData = '', ajson = null;
			var resError = null;
			var res = null;
			var req = https.request(opts, function(r) {
				res = r;
				res.on('data', function(chunk) {
					resData += chunk;
					grunt.verbose.writeln('Receiving upload response');
				});
				res.on('end', function() {
					grunt.verbose.writeln('Received upload response');
					que.add(postRleaseAssetEnd).resume();
				});
				grunt.log.writeln('Waiting for response');
			});
			req.on('error', function(e) {
				resError = e;
				que.add(postRleaseAssetEnd).resume();
			});
			// stream asset to remote host
			fs.createReadStream(asset.item.path, {
				'bufferSize' : 64 * 1024
			}).pipe(req);

			function postRleaseAssetEnd() {
				if (resError) {
					que.error('Release asset upload failed', resError);
				} else if (gitHubSuccessHttpCodes.indexOf(res.statusCode) >= 0) {
					ajson = chk(JSON.parse(resData.replace(regexLines, ' ')));
					if (ajson && ajson.state !== 'uploaded') {
						var msg = 'Asset upload failed with state: '
								+ ajson.state + ' for ' + util.inspect(ajson, {
									colors : true
								});
						que.error(msg);
					} else {
						var durl = 'https://' + options.gitHostname + '.com/'
								+ commit.username + '/' + commit.reponame
								+ '/releases/download/' + commit.versionTag
								+ '/' + ajson[gitHubReleaseName];
						// make asset avaliable via commit
						commit.releaseAssets.push({
							asset : ajson,
							downloadUrl : durl
						});
						grunt.log.writeln('Asset ID '
								+ ajson[gitHubReleaseAssetId]
								+ ' successfully ' + ajson.state + ' for '
								+ asset.item.name + ' ' + asset.item.path
								+ ' (downloadable at: ' + durl + ')');
						if (grunt.option('verbose')) {
							grunt.verbose.writeln(util.inspect(ajson, {
								colors : true
							}));
						}
					}
				} else {
					var dstr = util.inspect(resData);
					que.error('Asset upload failed with HTTP status: '
							+ res.statusCode + ' data: ' + dstr);
				}
				// check for more assets to upload
				asset = nextAsset();
				que.add(asset.cb);
			}
		}

		function postReleaseRollback() {
			var res = null, rrdata = '';
			try {
				// pause and wait for response
				que.pauseRollback();
				opts.path = releasePath + '/' + commit.releaseId.toString();
				opts.method = 'DELETE';
				opts.hostname = host;
				opts.headers['Content-Length'] = 0;
				grunt.log.writeln('Rolling back ' + commit.versionTag
						+ ' release via ' + options.gitHostname + ' '
						+ opts.method + ' ' + opts.path);
				var rreq = https.request(opts, function(r) {
					res = r;
					res.on('data', function(chunk) {
						grunt.verbose
								.writeln('Receiving release rollback data');
						rrdata += chunk;
					});
					res.on('end', postReleaseRollbackEnd);
				});
				rreq.end();
				rreq.on('error', function(e) {
					var em = 'Failed to rollback release ID '
							+ commit.releaseId;
					que.error(em, e).resumeRollback();
				});
			} catch (e) {
				que.error('Failed to request rollback for release ID '
						+ commit.releaseId, e);
			}
			function postReleaseRollbackEnd() {
				try {
					var msg = 'Release rollback for release ID: '
							+ commit.releaseId;
					if (gitHubSuccessHttpCodes.indexOf(res.statusCode) >= 0) {
						grunt.log.writeln(msg + ' complete');
						grunt.verbose.writeln(rrdata);
					} else {
						que.error(msg + ' failed', rrdata);
					}
				} finally {
					que.resumeRollback();
				}
			}
		}
	}

	/**
	 * Synchronous queue that provides a means to add a function to a waiting
	 * queue along with an optional rollback function that will be called in a
	 * stack order whenever an {Error} is either thrown (stops further queued
	 * functions from firing) or when all queued functions have been called, but
	 * {Error}s have been logged
	 * 
	 * @constructor
	 * @param options
	 *            the task options
	 */
	function Queue(options) {
		var wrk = null, wrkq = [], wrkd = [], wrkrb = [], que = this, wi = -1, endc = null;
		var pausd = false, rbpausd = false, rbi = -1, rbcnt = 0, tm = null, es = new Errors(
				options);
		this.add = function(fx, rb) {
			wrk = new Work(fx, rb, Array.prototype.slice.call(arguments, 2));
			wrkq.push(wrk);
			return que;
		};
		this.addRollbacks = function() {
			if (arguments.length === 0) {
				return;
			}
			// make sure the order of the passed rollback functions is
			// maintained regardless of strategy
			var args = isStack() ? Array.prototype.reverse.call(arguments)
					: arguments;
			for ( var i = 0; i < args.length; i++) {
				que.addRollback(args[i]);
			}
		};
		this.addRollback = function(rb) {
			if (typeof rb === 'function') {
				if (typeof options.rollbackStrategy === 'string'
						&& /stack/i.test(options.rollbackStrategy)) {
					wrkrb.unshift(new Rollback(rb));
				} else {
					wrkrb.push(new Rollback(rb));
				}
			}
		};
		this.work = function() {
			return wrk;
		};
		this.start = function(end) {
			endc = end || endc;
			var stop = null;
			pausd = false;
			if (!que.hasQueued()) {
				return rollbacks();
			}
			for (wi++; wi < wrkq.length; wi++) {
				wrk = wrkq[wi];
				try {
					wrk.run();
					if (pausd) {
						return;
					}
				} catch (e) {
					stop = e;
					que.error(e);
				} finally {
					if (stop || (!pausd && !que.hasQueued())) {
						return rollbacks();
					}
				}
			}
		};
		this.hasQueued = function(i) {
			return (i || wi) < wrkq.length - 1;
		};
		this.pause = function() {
			pausd = true;
			return tko(rollbacks);
		};
		this.resume = function() {
			tko();
			if (!pausd) {
				return 0;
			}
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
		this.pauseRollback = function() {
			rbpausd = true;
			return tko(que.resumeRollback);
		};
		this.resumeRollback = function() {
			tko();
			if (!rbpausd) {
				return 0;
			}
			return rollbacks();
		};
		this.hasQueuedRollbacks = function() {
			return rbi < wrkrb.length - 1;
		};
		function rollbacks() {
			rbpausd = false;
			if (que.errorCount() > 0) {
				grunt.log.writeln('Processing ' + (wrkrb.length - rbcnt)
						+ ' rollback action(s)');
				for (rbi++; rbi < wrkrb.length; rbi++) {
					grunt.verbose
							.writeln('Calling rollback ' + wrkrb[rbi].name);
					try {
						wrkrb[rbi].run();
						rbcnt++;
						if (rbpausd) {
							grunt.verbose.writeln('Pausing after rollback '
									+ wrkrb[rbi].name);
							return rbcnt;
						}
					} catch (e) {
						que.error(e);
					}
				}
			}
			return endc ? endc.call(que, rbcnt) : rbcnt;
		}
		function Work(fx, rb, args) {
			this.func = fx;
			this.rb = rb ? new Rollback(rb, args) : null;
			this.args = args;
			this.rtn = undefined;
			this.run = function() {
				this.rtn = fx.apply(que, this.args);
				wrkd.push(this);
				que.addRollback(this.rb);
				return this.rtn;
			};
		}
		function Rollback(rb) {
			this.name = funcName(rb);
			this.run = function() {
				return typeof rb === 'function' ? rb.call(que) : false;
			};
		}
		function funcName(fx) {
			var n = fx ? regexFuncName.exec(fx.toString()) : null;
			return n && n[0] ? n[0] : '';
		}
		function tko(cb) {
			if (tm) {
				clearTimeout(tm);
			}
			if (typeof cb === 'function') {
				tm = setTimeout(function() {
					que.error('Timeout of '
							+ options.asyncTimeout
							+ 'ms reached'
							+ (cb === rollbacks ? ' rolling back changes'
									: ' for rollback'));
					cb();
				}, options.asyncTimeout);
			}
			return que;
		}
		function isStack() {
			return typeof options.rollbackStrategy === 'string'
					&& /stack/i.test(options.rollbackStrategy);
		}
	}

	/**
	 * Work/Error tracking
	 * 
	 * @constructor
	 * @param options
	 *            the task options
	 */
	function Errors(options) {
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
				if (options && util.isRegExp(options.hideTokenRegExp)) {
					e.message = e.message.replace(options.hideTokenRegExp,
							function(match, prefix, token, suffix) {
								return prefix + '[SECURE]' + suffix;
							});
				}
				errors.unshift(e);
				grunt.log.error(e.stack || e.message);
			}
		}
	}
};
