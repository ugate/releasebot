'use strict';

var npm = require('npm');
var fs = require('fs');
var pth = require('path');
var util = require('util');
var coopt = require('../lib/coopt');
var utils = require('../lib/utils');
var RollCall = require('../lib/rollcall');
var github = require('../lib/github');

/**
 * When a commit message contains "release v" followed by a valid version number
 * (major.minor.patch) a tagged release will be issued
 * 
 * @param grunt
 *            the grunt instance
 */
module.exports = function(grunt) {

	// generate commit using default global release environment options
	var commitTask = coopt._getCommitTask(grunt);
	var commit = commitTask.commit;
	var defTskOpts = commitTask.defaultTaskOptions;

	// register release task
	grunt.registerTask(coopt.pluginName, coopt.pluginDesc, function() {
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

		var tmpltData = genTemplateData('name', 'pkgCurrVerBumpMsg',
				'pkgNextVerBumpMsg', 'distBranchPubMsg');

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
				if (tmpltData.pkgNextVerBumpMsg) {
					// bump to next version
					pkgUpdate(null, false, true);
				}
			} catch (e) {
				rollCall.error('Failed to bump next release version', e);
			}
			try {
				coopt._cloneAndSetCommitTask(commitTask);
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
		 * Generates an object that contains each of the passed arguments as a
		 * property with a value of an option with the same name. Each property
		 * will have a value for that option that is parsed using the grunt
		 * template processor. When the processed value exists it will also be
		 * escaped for regular expression use and added to the escCmtMsgs
		 * {Array} property
		 * 
		 * @returns all of the grunt template parsed data
		 */
		function genTemplateData() {
			var templateData = {
				data : {
					process : process,
					commit : commit,
					env : commitTask.commitOpts,
					options : options
				}
			};
			var rtn = {
				escCmtMsgs : []
			};
			var arr = Array.prototype.slice.call(arguments, 0);
			arr.forEach(function genIntMsgs(s) {
				rtn[s] = options[s] ? grunt.template.process(options[s],
						templateData) : '';
				if (rtn[s]) {
					grunt.verbose.writeln(s + ' = ' + rtn[s]);
					rtn.escCmtMsgs.push(coopt.escapeRegExp(rtn[s]));
				}
			});
			return rtn;
		}

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
				if (!noPush && (u || r || n)) {
					cmd('git commit -q -m "'
							+ (r ? 'Rollback: ' : '')
							+ (n ? tmpltData.pkgNextVerBumpMsg
									: tmpltData.pkgCurrVerBumpMsg) + '" ' + p);
					cmd('git push ' + options.repoName + ' ' + commit.branch);
					pckBumped = u;
				}
				pkgLog(pkg, pkgStr, ov, u, r, n, p, false);
			}
			function pkgLog(pkg, pkgStr, ov, u, r, n, p, beforeWrite) {
				var skip = !n && !r && !u;
				var m = (skip ? 'Skip' : r ? 'Revert' : 'Bump')
						+ (beforeWrite ? 'ing' : (skip ? 'p' : '') + 'ed')
						+ (skip ? ' write:' : n ? ' next' : '')
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
			var lastGitLog = commit.prev && !commit.prev.versionVacant() ? commit.prev.versionTag
					+ '..HEAD'
					: 'HEAD';
			chgLogRtn = cmd('git --no-pager log ' + lastGitLog
					+ ' --pretty=format:"' + options.chgLogLineFormat + '" > '
					+ chgLogPath, null, false, chgLogPath,
					options.chgLogSkipRegExps, '<!-- Commit ' + commit.hash
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
			cmd('git commit -q -m "' + tmpltData.distBranchPubMsg + '"');
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
					+ (chgLogRtn ? chgLogRtn.replace(coopt.regexLines, '$1 \\')
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
			} ], grunt, coopt.regexLines, commit, tmpltData.name, chgLogRtn
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
							cmd('git commit -q -m "'
									+ tmpltData.distBranchPubMsg + '"');
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
				npm.registry.adduser(options.npmRegistryURL, auth[0], auth[1],
						pkg.author.email, aucb);
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
						cmd('git commit -q -m "Rollback: '
								+ tmpltData.distBranchPubMsg + '"');
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
		 * @param skipRegExps
		 *            an optional {Array} of {RegExp} to use for eliminating
		 *            specific content from the output (only used when in
		 *            conjunction with a valid duplicate path, combined using
		 *            OR)
		 * @param dupsPrefix
		 *            an optional prefix to the duplication replacement path
		 * @returns {String} command output
		 */
		function cmd(c, wpath, nofail, dupsPath, skipRegExps, dupsPrefix) {
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
				output = output.replace(coopt.regexKey, '$1[SECURE]$2');
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
							+ output.replace(coopt.regexDupLines, '$1');
					// skip content that matches any of the supplied expressions
					// and the release commit messages performed internally
					var rxs = Array.isArray(skipRegExps) ? tmpltData.escCmtMsgs
							.concat(skipRegExps) : tmpltData.escCmtMsgs;
					output = output.replace(coopt.getLineReplRegExp(rxs), '');
					output = replaceVersionTrigger(output);
					grunt.file.write(dupsPath, output);
				}
			}
			return output || '';
		}

		/**
		 * Replace the release message with the evaluated release message so
		 * that the actual version will be used (e.g. "release v1.0.0" rather
		 * than "release v+.*.*")
		 * 
		 * @param str
		 *            the string that contains the release trigger
		 * @returns the replaced string
		 */
		function replaceVersionTrigger(str) {
			var s = str || '';
			var cnt = 0;
			// use original commit.versionRegExp instead of
			// commit.versionTrigger in case there were previous commits that
			// have unsuccessful release triggers that are in a different format
			// than the current one
			s = str.replace(new RegExp(commit.versionRegExp.source, 'gmi'),
					function cmdCmtMsgRepl() {
						return ++cnt <= 1 ? commit.versionLabel
								+ commit.versionLabelSep + commit.versionTag
								: '';
					});
			return s;
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