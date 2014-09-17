'use strict';

var fs = require('fs');
var path = require('path');
var util = require('util');
var rbot = require('../releasebot');
var coopt = require('../lib/coopt');
var utils = require('../lib/utils');
var RollCall = require('../lib/rollcall');
var github = require('../lib/github');
var Pack = require('../lib/pack');
var Cmd = require('../lib/cmd');

module.exports = task;

/**
 * When a commit message contains "release v" followed by a valid version number
 * (major.minor.patch) a tagged release will be issued
 * 
 * @param rbot
 *            the releasebot instance
 */
function task() {

	// generate commit using default global release environment options
	var commitTask = coopt._getCommitTask();
	var commit = commitTask.commit;

	// register or run the release task (depends on task runner)
	rbot.task(commitTask.commitOpts.pluginName, commitTask.commitOpts.pluginDesc,
			function releaseTask() {
				var options = this.options(commitTask.defaultTaskOptions);
				if (options.gitHostname && commit.username) {
					options.hideTokenRegExp = new RegExp('(' + commit.username + ':)([0-9a-f]+)(@'
							+ options.gitHostname + ')');
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
		rbot.log.info('Preparing release: ' + commit.version + ' (last release: '
				+ (commit.prev.versionTag ? commit.prev.versionTag : 'N/A') + ')');
		var useGitHub = options.gitHostname.toLowerCase() === github.hostname;

		var tmpltData = genTemplateData('name', 'pkgCurrVerBumpMsg', 'pkgNextVerBumpMsg', 'distBranchPubMsg');

		var chgLogRtn = '', athrsRtn = '', pubHash = '', distAssets = [];
		var distZipAsset = '', distTarAsset = '', distZipAssetName = '', distTarAssetName = '';
		var pubSrcDir = options.distDir ? path.join(commit.buildDir, options.distDir) : commit.buildDir;
		var pubDistDir = options.distBranch ? commit.buildDir.replace(commit.reponame, options.distBranch) : '';

		// initialize library instances
		var rollCall = new RollCall(options);
		var cmdObj = new Cmd(commit, options, rollCall);
		var cmd = cmdObj.cmd;
		var chkoutRun = cmdObj.chkoutRun;
		var pack = new Pack(commit, options, rollCall, cmdObj);

		// start work
		rollCall.then(remoteSetup).then(pkgUpdate).then(changeLog).then(authorsLog).then(addAndCommitDistDir).then(
				genDistAssets);
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
			var msg = ecnt > 0 ? 'Processed ' + rbcnt + ' rollback action(s)' : 'Released ' + commit.versionTag;
			rbot.log.info(msg);

			// non-critical cleanup
			try {
				if (ecnt <= 0 && tmpltData.pkgNextVerBumpMsg) {
					// bump to next version
					pkgUpdate(null, null, false, true, true);
				}
			} catch (e) {
				rollCall.error('Failed to bump next release version', e);
			}
			try {
				// update the commit task
				coopt._cloneAndSetCommitTask(commitTask);
			} catch (e) {
				rollCall.error('Failed to set global commit result properties', e);
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
		 * will have a value for that option that is parsed using the template
		 * processor.
		 * 
		 * @returns the parsed template data
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
			var rtn = {};
			var arr = Array.prototype.slice.call(arguments, 0);
			arr.forEach(function genIntMsgs(s) {
				rtn[s] = options[s] ? rbot.processTemplate(options[s], templateData) : '';
				if (rtn[s]) {
					rbot.log.verbose(s + ' = ' + rtn[s]);
				}
			});
			return rtn;
		}

		/**
		 * Remote Git setup to permit pushes
		 */
		function remoteSetup() {
			var link = '${GH_TOKEN}@' + options.gitHostname + '/' + commit.slug + '.git';
			cmd('git config --global user.email "' + options.repoEmail + '"');
			cmd('git config --global user.name "' + options.repoUser + '"');
			cmd('git remote rm ' + options.repoName);
			cmd('git remote add ' + options.repoName + ' https://' + commit.username + ':' + link);
		}

		/**
		 * Updates the package file version using the current {Commit} version
		 * and commits/pushes it to remote
		 * 
		 * @param altPkgPath
		 *            the alternative path to the package that will be updated
		 * @param altPkgBowerPath
		 *            the alternative path to the bower package that will be
		 *            updated
		 * @param noPush
		 *            true to only update the package file
		 * @param isNext
		 *            true when the version should be updated to the next
		 *            version versus the default current one
		 * @param noRollback
		 *            true to exclude a rollback for the update
		 */
		function pkgUpdate(altPkgPath, altPkgBowerPath, noPush, isNext, noRollback) {
			chkoutRun(commit.branch, upkg, false, isNext);
			if (!noRollback) {
				rollCall.addRollback(function pkgUpdateRollback() {
					chkoutRun(commit.branch, upkg, true);
				});
			}
			function upkg(revert, next) {
				commit.versionPkg({
					replacer : options.pkgJsonReplacer,
					space : options.pkgJsonSpace,
					revert : revert,
					next : next,
					altWrite : pkgWritable,
					altPkgPath : altPkgPath,
					altPkgPathBower : altPkgBowerPath
				}, pkgPush);
			}
			function pkgWritable(pkgData) {
				pkgLog(pkgData, true);
				return pkgData.pkgStr;
			}
			function pkgPush(pd, pdBower) {
				// TODO : check to make sure there isn't any commits ahead of
				// this one
				if (!noPush && (pd.u || pd.r || pd.n)) {
					cmd('git commit -q -m "' + (pd.r ? 'Rollback: ' : '')
							+ (pd.n ? tmpltData.pkgNextVerBumpMsg : tmpltData.pkgCurrVerBumpMsg) + '" ' + pd.p);
					cmd('git push ' + options.repoName + ' ' + commit.branch);
				}
				pkgLog(pd, false);
				pkgLog(pdBower, false);
			}
			function pkgLog(pd, beforeWrite) {
				if (!pd) {
					return;
				}
				var skip = !pd.n && !pd.r && !pd.u;
				var m = (skip ? 'Skip' : pd.r ? 'Revert' : 'Bump') + (beforeWrite ? 'ing' : (skip ? 'p' : '') + 'ed')
						+ (skip ? ' write:' : pd.n ? ' next' : '') + ' version from ' + pd.oldVer + ' to '
						+ pd.pkg.version + ' in ' + pd.path;
				if (pd.r) {
					rbot.log.verbose(m);
				} else {
					rbot.log.info(m);
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
					throw new Error('Invalid "options.chgLog": "' + options.chgLog + '" ("options.chgLogRequired": '
							+ options.chgLogRequired + '"');
				}
				return;
			}
			var chgLogPath = path.join(options.distDir, options.chgLog);
			var lastGitLog = commit.prev && !commit.prev.versionVacant() ? commit.prev.versionTag + '..HEAD' : 'HEAD';
			chgLogRtn = cmd('git --no-pager log ' + lastGitLog + ' --pretty=format:"' + options.chgLogLineFormat
					+ '" > ' + chgLogPath, null, false, chgLogPath, options.chgLogSkipRegExps, '<!-- Commit '
					+ commit.hash + ' -->\n')
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
					throw new Error('Invalid "options.authors": "' + options.authors + '" ("options.authorsRequired": '
							+ options.authorsRequired + '"');
				}
				return;
			}
			var athrsPath = path.join(options.distDir, options.authors);
			athrsRtn = cmd('git --no-pager shortlog -sen HEAD > ' + athrsPath, null, false, athrsPath,
					options.authorsSkipLineRegExp)
					|| '';
			utils.validateFile(athrsPath, rollCall);
		}

		/**
		 * Adds/Commits everything in the distribution directory for tracking
		 */
		function addAndCommitDistDir() {
			if (commit.pkgPath && options.distDir && !/^(?:\.|\/)[^\.]/.test(options.distDir)) {
				// need to update the package included in the distribution
				pkgUpdate(path.join(options.distDir, commit.pkgPath), commit.pkgPathBower ? path.join(options.distDir,
						commit.pkgPathBower) : null, true, false);
			}
			if (options.distDir || athrsRtn || chgLogRtn) {
				if (options.distDir) {
					cmd('git add --force ' + options.distDir);
				}
				// Commit changes (needed to generate archive asset)
				cmd('git commit -q -m "' + tmpltData.distBranchPubMsg + '"');
			}
		}

		/**
		 * Generates distribution archive assets (i.e. zip/tar)
		 */
		function genDistAssets() {
			if (!options.distDir) {
				rbot.log.info('Skipping generation of distribution assets (no distDir)');
				return;
			}
			if (!options.distAssetDir) {
				rbot.log.info('Skipping generation of distribution assets (no distAssetDir)');
				return;
			}
			// give taskateers a chance to update branch file contents
			utils.updateFiles(options.distAssetUpdateFiles, options.distAssetUpdateFunction, commit.buildDir,
					rollCall.error);
			// Create distribution assets
			distZipAssetName = commit.reponame + '-' + commit.version + '-dist.zip';
			distZipAsset = genAsset(distZipAssetName, 'zip', true, 'application/zip');
			distTarAssetName = commit.reponame + '-' + commit.version + '-dist.tar.gz';
			distTarAsset = genAsset(distTarAssetName, 'tar.gz', false, 'application/x-compressed');

			/**
			 * Generates an Git archive asset and pushes an object
			 * w/path/name/contentType to the distribution assets {Array}
			 * 
			 * @param name
			 *            the name of the asset file
			 * @param type
			 *            the type/format the asset represents
			 * @param compress
			 *            true to add the compression ratio to the Git command
			 * @param ct
			 *            the Content-Type
			 * @returns the file path to the asset
			 */
			function genAsset(name, type, compress, ct) {
				var a = path.resolve(options.distAssetDir, name);
				cmd('git archive -o "' + a + '" --format=' + type
						+ (compress ? ' -' + options.distAssetCompressRatio : '') + ' HEAD:' + options.distDir);
				if (rbot.log.verboseEnabled) {
					rbot.log.verbose('Created ' + a + ' (size: ' + fs.statSync(a).size + ')');
				}
				distAssets.push({
					path : a,
					name : name,
					contentType : ct
				});
				return a;
			}
		}

		/**
		 * Tags release via standard Git CLI
		 */
		function gitRelease() {
			// Tag release
			rbot.log.info('Tagging release ' + commit.versionTag + ' via ' + options.gitHostname);
			cmd('git tag -f -a ' + commit.versionTag + ' -m "'
					+ (chgLogRtn ? chgLogRtn.replace(coopt.regexLines, '$1 \\') : commit.message) + '"');
			cmd('git push -f ' + options.repoName + ' ' + commit.versionTag);
			commit.releaseId = commit.versionTag;
			// TODO : upload asset?
			rollCall.addRollback(rollbackTag);
			rollCall.then(publish);
		}

		/**
		 * Calls the GitHub Release API to tag release and upload optional
		 * distribution asset
		 */
		function gitHubRelease() {
			rbot.log.info('Releasing ' + commit.versionTag + ' via ' + options.gitHostname);
			// GitHub Release API will not remove the tag when removing a
			// release
			github.releaseAndUploadAsset(distAssets, coopt.regexLines, commit, tmpltData.name, chgLogRtn
					|| commit.message, options, rollCall, rollbackTag, function() {
				rollCall.then(publish);
			});
		}

		/**
		 * Publish repository pages to distribution branch (commit should have a
		 * valid ID)
		 */
		function publish() {
			if (!options.distBranch) {
				rbot.log.info('Skipping publishing from "' + pubSrcDir + '" to ' + pubDistDir + ' (no distBranch)');
				return;
			} else if (!commit.releaseId) {
				rbot.log.info('Skipping publishing from "' + pubSrcDir + '" to "' + pubDistDir + '" in branch "'
						+ options.distBranch + '" (no releaseId/tag)');
				return;
			}
			rbot.log.info('Publishing to branch "' + options.distBranch + '"');
			rbot.log.info('Copying publication directories/files from "' + pubSrcDir + '" to "' + pubDistDir + '"');
			// copy all directories/files over that need to be published
			// so that they are not removed by the following steps
			rbot.log.info(utils.copyRecursiveSync(pubSrcDir, pubDistDir, options.distExcludeDirRegExp,
					options.distExcludeFileRegExp).toString());
			// cmd('cp -r ' + path.join(pubSrcDir, '*') + ' ' + pubDistDir);
			chkoutRun(null, publishRun);
			function publishRun() {
				try {
					cmd('git fetch ' + options.repoName + ' ' + options.distBranch);
					pubHash = cmd('git rev-parse HEAD');
				} catch (e) {
					if (util.isRegExp(options.distBranchCreateRegExp) && options.distBranchCreateRegExp.test(e.message)) {
						cmd('git checkout -q --orphan ' + options.distBranch);
					} else {
						throw e;
					}
				}
				if (pubHash) {
					cmd('git checkout -q --track ' + options.repoName + '/' + options.distBranch);
				}
				cmd('git rm -rfq .');
				cmd('git clean -dfq .');
				rbot.log.info('Copying publication directories/files from "' + pubDistDir + '" to "' + commit.buildDir
						+ '"');
				rbot.log.info(utils.copyRecursiveSync(pubDistDir, commit.buildDir).toString());
				// cmd('cp -r ' + path.join(pubDistDir, '*') + '
				// .');

				// give taskateers a chance to update branch file
				// contents
				utils.updateFiles(options.distBranchUpdateFiles, options.distBranchUpdateFunction, commit.buildDir,
						rollCall.error);

				cmd('git add -A');
				cmd('git commit -q -m "' + tmpltData.distBranchPubMsg + '"');
				cmd('git push -f ' + options.repoName + ' ' + options.distBranch);

				rollCall.addRollback(rollbackPublish);
				rollCall.then(pack.publish);
			}
		}

		/**
		 * Deletes tag using Git CLI
		 */
		function rollbackTag() {
			cmd('git push --delete ' + options.repoName + ' ' + commit.versionTag);
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
						cmd('git commit -q -m "Rollback: ' + tmpltData.distBranchPubMsg + '"');
						cmd('git push -f ' + options.repoName + ' ' + options.distBranch);
					} else if (!pubHash) {
						cmd('git push ' + options.repoName + ' --delete ' + options.distBranch);
					} else {
						rbot.log.verbose('Skipping rollback for ' + options.distBranch + ' for hash "' + pubHash
								+ '" (current hash: "' + cph + '")');
					}
				});
			} catch (e) {
				var msg = 'Failed to rollback publish branch changes!';
				rollCall.error(msg, e);
			}
		}
	}
}