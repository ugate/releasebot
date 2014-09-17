'use strict';

var util = require('util');
var fs = require('fs');
var path = require('path');
var rbot = require('../releasebot');

var utils = exports;
utils.copyRecursiveSync = copyRecursiveSync;
utils.validateFile = validateFile;
utils.updateFiles = updateFiles;

/**
 * Copies files/directories recursively
 * 
 * @param src
 *            the source path
 * @param dest
 *            the destination path
 * @param dirExp
 *            an optional regular expression that will be tested for exclusion
 *            before each directory is copied
 * @param fileExp
 *            an optional regular expression that will be tested for exclusion
 *            before each file is copied
 * @returns {Object} status of the copied resources
 */
function copyRecursiveSync(src, dest, dirExp, fileExp) {
	var stats = {
		dirCopiedCount : 0,
		dirSkips : [],
		fileCopiedCount : 0,
		fileSkips : [],
		toString : function() {
			return this.dirCopiedCount + ' directories/' + this.fileCopiedCount + ' files copied'
					+ (this.dirSkips.length > 0 ? ' Skipped directories: ' + this.dirSkips.join(',') : '')
					+ (this.fileSkips.length > 0 ? ' Skipped files: ' + this.fileSkips.join(',') : '');
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
				crs(s, path.join(src, name), path.join(dest, name));
			});
		} else {
			if (fileExp && util.isRegExp(fileExp) && fileExp.test(src)) {
				s.fileSkips.push(src);
				return;
			}
			fs.linkSync(src, dest);
			s.fileCopiedCount++;
			// console.log('Copied "' + src + '" to "' + dest + '"');
		}
	}
}

/**
 * Determines if a file has content and logs an error when the the file is empty
 * 
 * @param path
 *            the path to the file
 * @param the
 *            roll call instance
 * @returns true when the file contains data or the path is invalid
 */
function validateFile(path, rollCall) {
	var stat = path ? fs.statSync(path) : {
		size : 0
	};
	if (!stat.size) {
		rollCall.error('Failed to find any entries in "' + path + '" (file size: ' + stat.size + ')');
		return false;
	}
	return true;
}

/**
 * Updates file contents using a specified function
 * 
 * @param files
 *            the {Array} of files to read/write
 * @param func
 *            the function to call for the read/write operation
 * @param bpath
 *            the base path to that will be used to prefix each file used in the
 *            update process
 * @param eh
 *            an optional function that will be called when the update fails
 * @returns {String} the replaced URL (undefined if nothing was replaced)
 */
function updateFiles(files, func, bpath, eh) {
	try {
		if (Array.isArray(files) && typeof func === 'function') {
			for (var i = 0; i < files.length; i++) {
				var p = path.join(bpath, files[i]), au = '';
				var content = rbot.file.read(p, {
					encoding : rbot.file.defaultEncoding
				});
				var ec = func(content, p);
				if (content !== ec) {
					rbot.file.write(p, ec);
					return au;
				}
			}
		}
	} catch (e) {
		if (typeof eh === 'function') {
			return eh('Unable to update "' + (Array.isArray(files) ? files.join(',') : '') + '" using: ' + func, e);
		}
		throw e;
	}
}