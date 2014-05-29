'use strict';

var util = require('util');
var fs = require('fs');
var regexHost = /^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i;
var regexParam = /{(\?.+)}/;
var releaseTagName = 'tag_name';
var releaseUploadUrl = 'upload_url';
var releaseCommitish = 'target_commitish';
var releaseAssetId = 'id';
var releaseId = 'id';
var releaseName = 'name';
var releaseBody = 'body';
// var releaseDraftFlag = 'draft';
var releasePreFlag = 'prerelease';
// var releaseErrors = 'errors';
var releaseErrorMsg = 'message';
var httpSuccessCodes = [ 200, 201, 204 ];
var hostName = exports.hostname = 'github.com';
var host = exports.apiHost = 'api.' + hostName;

/**
 * Tags/Releases from default branch (see
 * http://developer.github.com/v3/repos/releases/#create-a-release ) and Uploads
 * the file asset and associates it with a specified tagged release (see
 * http://developer.github.com/v3/repos/releases/#upload-a-release-asset )
 * 
 * @param assets
 *            an {Array} of objects each containing a <code>path</code>,
 *            <code>contentType</code> and <code>name</code> of an asset to
 *            be uploaded (optional)
 * @param grunt
 *            the grunt instance
 * @param regexLines
 *            the regular expression used to remove duplicate lines
 * @param commit
 *            the commit object the asset is for
 * @param name
 *            of release
 * @param desc
 *            release description (can be in markdown)
 * @param options
 *            the task options
 * @param rollCall
 *            the roll call instance
 * @param fcb
 *            the call back function that will be called when the release fails
 * @param cb
 *            the call back function called when completed successfully
 */
exports.releaseAndUploadAsset = function releaseAndUploadAsset(assets, grunt,
		regexLines, commit, name, desc, options, rollCall, fcb, cb) {
	var authToken = typeof commit.gitToken === 'function' ? commit.gitToken()
			: commit.gitToken;
	if (!authToken) {
		rollCall.error('Invalid authorization token').then(cb);
		return;
	}
	var rl = null;
	// check if API responded with an error message
	function chk(o) {
		if (o[releaseErrorMsg]) {
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
		a.cb = function() {
			if (!a.item || a.size <= 0) {
				// roll call completion callback
				rollCall.then(cb);
			} else {
				// pause and wait for response
				rollCall.pause(postReleaseAsset);
			}
		};
		return a;
	}
	var json = {};
	json[releaseTagName] = commit.versionTag;
	json[releaseName] = name || commit.versionTag;
	json[releaseBody] = desc;
	json[releaseCommitish] = commit.hash;
	json[releasePreFlag] = typeof commit.versionPrereleaseType === 'string'
			&& commit.versionPrereleaseType;
	var jsonStr = JSON.stringify(json);
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

	// pause roll call and wait for response
	rollCall.pause(postRelease);

	function postRelease() {
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
				grunt.verbose.writeln('Receiving post release chunked data');
			});
			res.on('end', function() {
				if (httpSuccessCodes.indexOf(res.statusCode) >= 0) {
					grunt.verbose.writeln('Received post release data');
					rollCall.then(postReleaseEnd).resume();
				} else {
					rollCall.error(
							'Release post failed with HTTP status: '
									+ res.statusCode + ' data: '
									+ util.inspect(resData)).then(cb).resume();
				}
			});
		});
		req.end(jsonStr);
		req.on('error', function(e) {
			rollCall.error('Release post failed', e).then(cb).resume();
		});
		function postReleaseEnd() {
			var success = httpSuccessCodes.indexOf(res.statusCode) >= 0;
			rl = success ? chk(JSON.parse(resData.replace(regexLines, ' ')))
					: null;
			if (grunt.option('verbose')) {
				grunt.verbose.writeln(util.inspect(rl, {
					colors : true
				}));
			}
			if (rl && rl[releaseTagName] === commit.versionTag) {
				commit.releaseId = rl[releaseId];
				// roll call asset uploaded or complete with callback
				rollCall.addRollbacks(postReleaseRollback, fcb);
				asset.cb();
			} else {
				rollCall.error(
						'No tag found for ' + commit.versionTag + ' in '
								+ util.inspect(rl, {
									colors : true
								}) + ' HTTP Status: ' + res.statusCode
								+ ' Response: \n' + resData).then(cb);
			}
		}
	}

	function postReleaseAsset() {
		grunt.log.writeln('Uploading "' + asset.item.path
				+ '" release asset for ' + commit.versionTag + ' via '
				+ options.gitHostname);
		opts.method = 'POST';
		opts.path = rl[releaseUploadUrl].replace(regexHost, function(m, h) {
			opts.hostname = h;
			return '/';
		});
		opts.path = opts.path.replace(regexParam, '$1='
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
				rollCall.then(postRleaseAssetEnd).resume();
			});
			grunt.log.writeln('Waiting for response');
		});
		req.on('error', function(e) {
			resError = e;
			rollCall.then(postRleaseAssetEnd).resume();
		});
		// stream asset to remote host
		fs.createReadStream(asset.item.path, {
			'bufferSize' : 64 * 1024
		}).pipe(req);

		function postRleaseAssetEnd() {
			if (resError) {
				rollCall.error('Release asset upload failed', resError);
			} else if (httpSuccessCodes.indexOf(res.statusCode) >= 0) {
				ajson = chk(JSON.parse(resData.replace(regexLines, ' ')));
				if (ajson && ajson.state !== 'uploaded') {
					var msg = 'Asset upload failed with state: ' + ajson.state
							+ ' for ' + util.inspect(ajson, {
								colors : true
							});
					rollCall.error(msg);
				} else {
					var durl = 'https://' + options.gitHostname + '.com/'
							+ commit.username + '/' + commit.reponame
							+ '/releases/download/' + commit.versionTag + '/'
							+ ajson[releaseName];
					// make asset avaliable via commit
					commit.releaseAssets.push({
						asset : ajson,
						downloadUrl : durl
					});
					grunt.log.writeln('Asset ID ' + ajson[releaseAssetId]
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
				rollCall.error('Asset upload failed with HTTP status: '
						+ res.statusCode + ' data: ' + dstr);
			}
			// check for more assets to upload
			asset = nextAsset();
			asset.cb();
		}
	}

	function postReleaseRollback() {
		var res = null, rrdata = '';
		try {
			// pause and wait for response
			rollCall.pauseRollback();
			opts.path = releasePath + '/' + commit.releaseId.toString();
			opts.method = 'DELETE';
			opts.hostname = host;
			opts.headers['Content-Length'] = 0;
			grunt.log.writeln('Rolling back ' + commit.versionTag
					+ ' release via ' + options.gitHostname + ' ' + opts.method
					+ ' ' + opts.path);
			var rreq = https.request(opts, function(r) {
				res = r;
				res.on('data', function(chunk) {
					grunt.verbose.writeln('Receiving release rollback data');
					rrdata += chunk;
				});
				res.on('end', postReleaseRollbackEnd);
			});
			rreq.end();
			rreq.on('error', function(e) {
				var em = 'Failed to rollback release ID ' + commit.releaseId;
				rollCall.error(em, e).resumeRollback();
			});
		} catch (e) {
			rollCall.error('Failed to request rollback for release ID '
					+ commit.releaseId, e);
		}
		function postReleaseRollbackEnd() {
			try {
				var msg = 'Release rollback for release ID: '
						+ commit.releaseId;
				if (httpSuccessCodes.indexOf(res.statusCode) >= 0) {
					grunt.log.writeln(msg + ' complete');
					grunt.verbose.writeln(rrdata);
				} else {
					rollCall.error(msg + ' failed', rrdata);
				}
			} finally {
				rollCall.resumeRollback();
			}
		}
	}
};