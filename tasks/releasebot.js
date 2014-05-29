'use strict';

var npm = require('npm');
var fs = require('fs');
var pth = require('path');
var util = require('util');
var utils = require('../lib/utils');
var committer = require('../lib/committer');
var RollCall = require('../lib/rollcall');
var github = require('../lib/github');
var pluginName = 'releasebot';
var regexVersion = /(v)((?:(\d+|\+|\*)(\.)(\d+|\+|\*)(\.)(\d+|\+|\*)(?:(-)(alpha|beta|rc|\+|\*?)(?:(\.)?(\d+|\+|\*))?)?))/mi;
var regexRelease = new RegExp(/(releas(?:e|ed|ing))\s*/.source
		+ regexVersion.source, 'mi');
var regexBump = new RegExp(/(bump(?:ed|ing)?)\s*/.source + regexVersion.source,
		'mi');
var pluginDesc = 'Git commit message triggered grunt task that tags a release (GitHub Release API '
		+ 'supported), generates/uploads a release distribution asset archive, publishes a '
		+ 'distribution asset\'s content to a specified branch and publishes to npm when a '
		+ 'commit message matches the regular expression pattern: '
		+ regexRelease
		+ ' (for Travis CI set git: depth: in .travis.yml to a higher value than the default value '
		+ ' of 1 in order to properly capture change log)';
var regexSkipChgLog = /\[skip\s*CHANGELOG\]/gmi;
var regexLines = /(\r?\n)/g;
var regexDupLines = /^(.*)(\r?\n\1)+$/gm;
var regexKey = /(https?:\/\/|:)+(?=[^:]*$)[a-z0-9]+(@)/gmi;

/**
 * When a commit message contains "release v" followed by a valid version number
 * (major.minor.patch) a tagged release will be issued
 * 
 * @param grunt
 *            the grunt instance
 */
module.exports = function(grunt) {

	// initialize global release environment options
	var commit = committer.init(grunt, pluginName, regexLines, {
		pkgPath : grunt.config('pkgFile') || 'package.json',
		gitCliSubstitute : '',
		buildDir : process.env.TRAVIS_BUILD_DIR || process.cwd(),
		branch : process.env.TRAVIS_BRANCH,
		commitHash : process.env.TRAVIS_COMMIT,
		commitMessage : process.env.TRAVIS_COMMIT_MESSAGE,
		repoSlug : process.env.TRAVIS_REPO_SLUG,
		releaseVersionDefaultLabel : 'release',
		releaseVersionDefaultType : 'v',
		releaseVersionRegExp : regexRelease,
		bumpVersionRegExp : regexBump,
		prevVersionMsgIgnoreRegExp : /No names found/i,
		gitToken : process.env.GH_TOKEN,
		npmToken : process.env.NPM_TOKEN
	});

	// initialize default task options
	var defTskOpts = {
		name : '<%= commit.versionTag %>',
		pkgCurrVerBumpMsg : 'Updating <%= commit.pckPath %> version to match release version <%= commit.version %> <%= commit.skipTaskGen(options.releaseSkipTasks) %>',
		pkgNextVerBumpMsg : 'Bumping <%= commit.pckPath %> version to <%= commit.next.version %> <%= commit.skipTaskGen(options.releaseSkipTasks) %>',
		distBranchPubMsg : 'Publishing <%= commit.version %> <%= commit.skipTaskGen(options.releaseSkipTasks) %>',
		pkgJsonReplacer : null,
		pkgJsonSpace : 2,
		gitHostname : github.hostname,
		repoName : 'origin',
		repoUser : pluginName,
		repoEmail : pluginName
				+ '@'
				+ (process.env.TRAVIS_BUILD_NUMBER ? 'travis-ci.org'
						: 'example.org'),
		chgLog : 'HISTORY.md',
		authors : 'AUTHORS.md',
		chgLogLineFormat : '  * %s',
		chgLogRequired : true,
		chgLogSkipRegExp : new RegExp('.*(?:(?:' + commit.versionRegExp.source
				+ ')|(' + regexSkipChgLog.source + ')|(Merge\\sbranch\\s\''
				+ commit.branch + '\')).*\r?\n', 'g'
				+ (commit.versionRegExp.multiline ? 'm' : '')
				+ (commit.versionRegExp.ignoreCase ? 'i' : '')),
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
		rollbackAsyncTimeout : 60000,
		asyncTimeout : 60000,
		releaseSkipTasks : [ 'ci' ],
		npmTag : ''
	};

	// register release task
	grunt.registerTask(pluginName, pluginDesc, function() {
		var options = this.options(defTskOpts);
		if (options.gitHostname && commit.username) {
			options.hideTokenRegExp = new RegExp('(' + commit.username
					+ ':)([0-9a-f]+)(@' + options.gitHostname + ')');
		}
		release(this, options);
	});

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
		grunt.log.writeln('Preparing release: ' + commit.version
				+ ' (last release: '
				+ (commit.prev.versionTag ? commit.prev.versionTag : 'N/A')
				+ ')');
		var useGitHub = options.gitHostname.toLowerCase() === github.hostname;
		var templateData = {
			data : {
				process : process,
				commit : commit,
				options : options
			}
		};
		var releaseName = grunt.template.process(options.name, templateData);
		var pkgCVBM = grunt.template.process(options.pkgCurrVerBumpMsg,
				templateData);
		var pkgNVBM = options.pkgNextVerBumpMsg ? grunt.template.process(
				options.pkgNextVerBumpMsg, templateData) : '';
		var distBPM = grunt.template.process(options.distBranchPubMsg,
				templateData);
		var chgLogRtn = '', pubSrcDir = '', pubDistDir = '', pubHash = '', pckBumped = false;
		var distZipAsset = '', distTarAsset = '', distZipAssetName = '', distTarAssetName = '';

		// Start work
		var rollCall = new RollCall(grunt, options).then(remoteSetup).then(
				pkgUpdate).then(changeLog).then(authorsLog);
		rollCall.then(addAndCommitDistDir).then(genDistAssets);
		rollCall.then(function() {
			if (useGitHub) {
				doneAsync = task.async();
				rollCall.then(gitHubRelease);
			} else {
				rollCall.then(gitRelease);
			}
		});
		// begin release
		rollCall.start(function(rbcnt) {
			var ecnt = rollCall.errorCount();
			var msg = ecnt > 0 ? 'Processed ' + rbcnt + ' rollback action(s)'
					: 'Released ' + commit.versionTag;
			grunt.log.writeln(msg);

			// non-critical cleanup
			try {
				if (pkgNVBM) {
					// bump to next version
					pkgUpdate(null, false, true);
				}
			} catch (e) {
				rollCall.error('Failed to bump next release version', e);
			}
			try {
				committer.cloneAndSetCommit(commit, null);
			} catch (e) {
				rollCall.error('Failed to set global commit result properties',
						e);
			}

			// complete
			if (doneAsync) {
				doneAsync(ecnt <= 0);
			} else if (ecnt > 0) {
				throw new Error('Release failed');
			}
		});

		/**
		 * Remote Git setup to permit pushes
		 */
		function remoteSetup() {
			var link = '${GH_TOKEN}@' + options.gitHostname + '/' + commit.slug
					+ '.git';
			cmd('git config --global user.email "' + options.repoEmail + '"');
			cmd('git config --global user.name "' + options.repoUser + '"');
			cmd('git remote rm ' + options.repoName);
			cmd('git remote add ' + options.repoName + ' https://'
					+ commit.username + ':' + link);
		}

		/**
		 * Updates the package file version using the current {Commit} version
		 * and commits/pushes it to remote
		 * 
		 * @param altPkgPath
		 *            the alternative path to the package that will be updated
		 * @param noPush
		 *            true to only update the package file
		 * @param isNext
		 *            true when the version should be updated to the next
		 *            version versus the default curront one
		 */
		function pkgUpdate(altPkgPath, noPush, isNext) {
			chkoutRun(commit.branch, upkg, false, isNext);
			rollCall.addRollback(function() {
				chkoutRun(commit.branch, upkg, true);
			});
			function upkg(revert, next) {
				commit.versionPkg(options.pkgJsonReplacer,
						options.pkgJsonSpace, revert, next, pkgWritable,
						pkgPush, altPkgPath);
			}
			function pkgWritable(pkg, pkgStr, ov, u, r, n, p) {
				pkgLog(pkg, pkgStr, ov, u, r, n, p, true);
				return pkgStr;
			}
			function pkgPush(pkg, pkgStr, ov, u, r, n, p) {
				// TODO : check to make sure there isn't any commits ahead of
				// this one
				if (!noPush) {
					cmd('git commit -q -m "' + (r ? 'Rollback: ' : '')
							+ (n ? pkgNVBM : pkgCVBM) + '" ' + p);
					cmd('git push ' + options.repoName + ' ' + commit.branch);
					pckBumped = u;
				}
				pkgLog(pkg, pkgStr, ov, u, r, n, p, false);
			}
			function pkgLog(pkg, pkgStr, ov, u, r, n, p, beforeWrite) {
				var m = (r ? 'Revert' : 'Bump') + (beforeWrite ? 'ing' : 'ed')
						+ (n ? ' next ' : '') + ' version from ' + ov + ' to '
						+ pkg.version + ' in ' + p;
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
			var lastGitLog = commit.prev && !commit.prev.versionVacant() ? commit.prev.versionTag
					+ '..HEAD'
					: 'HEAD';
			chgLogRtn = cmd('git --no-pager log ' + lastGitLog
					+ ' --pretty=format:"' + options.chgLogLineFormat + '" > '
					+ chgLogPath, null, false, chgLogPath,
					options.chgLogSkipRegExp, '<!-- Commit ' + commit.hash
							+ ' -->\n')
					|| '';
			utils.validateFile(chgLogPath, rollCall);
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
			utils.validateFile(authorsPath, rollCall);
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
			cmd('git commit -q -m "' + distBPM + '"');
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
			rollCall.addRollback(rollbackTag);
			rollCall.then(publish);
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
			github.releaseAndUploadAsset([ {
				path : distZipAsset,
				name : distZipAssetName,
				contentType : 'application/zip'
			}, {
				path : distTarAsset,
				name : distTarAssetName,
				contentType : 'application/x-compressed'
			} ], grunt, regexLines, commit, releaseName, chgLogRtn
					|| commit.message, options, rollCall, rollbackTag,
					function() {
						rollCall.then(publish);
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
				grunt.log.writeln(utils.copyRecursiveSync(pubSrcDir,
						pubDistDir, options.distExcludeDirRegExp,
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
							grunt.log.writeln(utils.copyRecursiveSync(
									pubDistDir, commit.buildDir).toString());
							// cmd('cp -r ' + pth.join(pubDistDir, '*') + ' .');

							// give taskateers a chance to update branch file
							// contents
							updateFiles(options.distBranchUpdateFiles,
									options.distBranchUpdateFunction,
									commit.buildDir);

							cmd('git add -A');
							cmd('git commit -q -m "' + distBPM + '"');
							cmd('git push -f ' + options.repoName + ' '
									+ options.distBranch);

							rollCall.addRollback(rollbackPublish);
							rollCall.then(publishNpm);
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
				go();
			} else {
				grunt.verbose.writeln('Skipping npm publish'
						+ (pckBumped ? '' : ' ' + commit.pkgPath
								+ ' not bumped to ' + commit.version));
			}
			function go() {
				pkg = grunt.file.readJSON(commit.pkgPath);
				if (!pkg || !pkg.author || !pkg.author.email) {
					rollCall
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
						rollCall.error('npm NPM_TOKEN is missing or invalid');
					} else {
						rollCall.pause(function() {
							npm.load({}, function(e) {
								if (e) {
									rollCall.error('npm load failed', e)
											.resume();
								} else {
									rollCall.pause(adduser);
								}
							});
						});
					}
				}
			}
			function adduser() {
				npm.config.set('email', pkg.author.email, 'user');
				npm.registry.adduser(auth[0], auth[1], pkg.author.email, aucb);
				function aucb(e) {
					if (e) {
						rollCall.error(
								'npm publish failed to be authenticated', e)
								.resume();
					} else {
						rollCall.pause(pub);
					}
				}
			}
			function pub() {
				var pargs = [];
				if (options.npmTag) {
					pargs.push('--tag ' + options.npmTag);
				}
				grunt.log.writeln('npm publish ' + pargs.join(' '));
				// switch to the master branch so publish will pickup the
				// right version
				chkoutCmd(commit.branch);
				npm.commands.publish(pargs, function(e) {
					if (e) {
						rollCall.error('npm publish failed', e).resume();
					} else {
						rollCall.pause(postPub);
					}
				});
				function postPub() {
					chkoutRun(null, function() {
						grunt.verbose.writeln('npm publish complete');
						rollCall.resume();
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
						cmd('git commit -q -m "Rollback: ' + distBPM + '"');
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
				rollCall.error(msg, e);
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
				rtn = utils.execCmd(c, commit.gitCliSubstitute);
			} else {
				rtn = utils.shell[c.shell].apply(utils.shell, c.args);
			}
			if (rtn.code !== 0) {
				var e = 'Error "' + rtn.code + '" for commit hash '
						+ commit.hash + ' ' + rtn.output;
				if (nofail) {
					rollCall.error(e);
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
					for (var i = 0; i < files.length; i++) {
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
				rollCall.error('Unable to update publish release asset URL', e);
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
					return fx.apply(rollCall, Array.prototype.slice.call(
							arguments, 2));
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
	}
};