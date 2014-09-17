'use strict';

var shell = require('shelljs');
var coopt = require('./coopt');
var rbot = require('../releasebot');

var cmd = module.exports = Cmd;
cmd.execCmd = execCmd;

var regexGitCmd = /^git/;

/**
 * Command constructor
 * 
 * @constructor
 * @param commit
 *            the commit instance
 * @param options
 *            the options
 * @param rollCall
 *            the roll call instance
 */
function Cmd(commit, options, rollCall) {
	this.commit = commit;
	this.options = options;
	this.rollCall = rollCall;
}

/**
 * Executes a shell command
 * 
 * @param c
 *            the command string to execute
 * @param wpath
 *            the optional path/file to write the results to
 * @param nofail
 *            true to prevent throwing an error when the command fails to
 *            execute
 * @param dupsPath
 *            path to the command output that will be read, duplicate entry
 *            lines removed and re-written
 * @param skipRegExps
 *            an optional {Array} of {RegExp} to use for eliminating specific
 *            content from the output (only used when in conjunction with a
 *            valid duplicate path, combined using OR)
 * @param dupsPrefix
 *            an optional prefix to the duplication replacement path
 * @returns {String} command output
 */
Cmd.prototype.cmd = function cmd(c, wpath, nofail, dupsPath, skipRegExps, dupsPrefix) {
	rbot.log.info(c);
	var rtn = null;
	if (typeof c === 'string') {
		rtn = execCmd(c, this.commit.gitCliSubstitute);
	} else {
		rtn = shell[c.shell].apply(shell, c.args);
	}
	if (rtn.code !== 0) {
		var e = 'Error "' + rtn.code + '" for commit hash ' + this.commit.hash + ' ' + rtn.output;
		if (nofail) {
			this.rollCall.error(e);
			return;
		}
		throw new Error(e);
	}
	var output = rtn.output;
	if (output) {
		output = output.replace(coopt.regexKey, '$1[SECURE]$2');
	}
	if (output && wpath) {
		rbot.file.write(wpath, output);
	}
	if (dupsPath) {
		// remove duplicate lines
		if (!output) {
			output = rbot.file.read(dupsPath, {
				encoding : rbot.file.defaultEncoding
			});
		}
		if (output) {
			// skip content that matches any of the supplied expressions
			var rxl = coopt.getLineReplRegExp(skipRegExps);
			rbot.log.verbose('Replacing output using: ' + rxl);
			output = output.replace(rxl, '');
			// replace duplicate lines
			output = (dupsPrefix ? dupsPrefix : '') + output.replace(coopt.regexDupLines, '$1');
			// use calculated version instead of trigger version
			output = this.replaceVersionTrigger(output);
			rbot.file.write(dupsPath, output);
		}
	}
	return output || '';
};

/**
 * Replace the release message with the evaluated release message so that the
 * actual version will be used (e.g. "release v1.0.0" rather than "release
 * v+.*.*")
 * 
 * @param str
 *            the string that contains the release trigger
 * @returns the replaced string
 */
Cmd.prototype.replaceVersionTrigger = function replaceVersionTrigger(str) {
	var s = str || '';
	var cnt = 0;
	var self = this;
	// use original commit.versionRegExp instead of commit.versionTrigger in
	// case there were previous commits that have unsuccessful release triggers
	// that are in a different format than the current one
	s = str.replace(new RegExp(self.commit.versionRegExp.source, 'gmi'), function cmdCmtMsgRepl() {
		return ++cnt <= 1 ? self.commit.versionLabel + self.commit.versionLabelSep + self.commit.versionTag : '';
	});
	return s;
};

/**
 * Wraps an optional function with a finally block that will checkout the
 * current commit after execution. All passed arguments will be passed (besides
 * the arguments passed into this function) and returned
 * 
 * @param chkout
 *            an optional options appended to a Git checkout command that will
 *            be executed prior to executing the specified function
 * @param fn
 *            optional function that will be wrapped with a finally block that
 *            will checkout the current commit
 * @returns the return value from the passed function
 */
Cmd.prototype.chkoutRun = function chkoutRun(chkout, fn) {
	try {
		if (chkout) {
			this.chkoutCmd(chkout);
		}
		if (typeof fn === 'function') {
			return fn.apply(this.rollCall, Array.prototype.slice.call(arguments, 2));
		}
	} finally {
		this.chkoutCmd();
	}
};

/**
 * Git checkout for the commit (or alt)
 * 
 * @param alt
 *            the string to append to the checkout command
 */
Cmd.prototype.chkoutCmd = function chkoutCmd(alt) {
	this.cmd('git checkout -q ' + (alt || this.commit.hash || this.commit.branch));
};

/**
 * Executes a shell command
 * 
 * @param c
 *            the command to execute
 * @param gcr
 *            the optional command replacement that will be substituted for the
 *            "git" CLI (when applicable)
 */
function execCmd(c, gcr) {
	return shell.exec(gcr ? c.replace(regexGitCmd, gcr) : c, {
		silent : true
	});
}