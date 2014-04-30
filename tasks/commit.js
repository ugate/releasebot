'use strict';

var semver = require('semver');
var fs = require('fs');
var util = require('util');
var utils = require('./utils');
var regexVerCurr = /\*/;
var regexVerBump = /\+/g;
var regexSkips = /\[\s?skip\s+(.+)\]/gmi;
var regexSlug = /^(?:.+\/)(.+\/[^\.]+)/;
var regexVerLines = /^v|(\r?\n)/g;
var regexKeyVal = /="(.+)"$/;
var regexToken = /token$/i;
var preReleaseTypes = [ 'alpha', 'beta', 'rc' ];
var grunt = null, pluginName = '', configEnv = '', configCommit = '', regexLines = '';
exports = module.exports = create;

/**
 * Initializes the global environment and returns {Commit} related data
 * 
 * @param grnt
 *            the grunt instance
 * @param name
 *            the name to use for the plug-in
 * @param rxLines
 *            the regular expression to use for removing lines
 * @param env
 *            the environment object
 * @returns {Commit}
 */
function create(grnt, name, rxLines, env) {
	grunt = grnt;
	pluginName = name;
	configEnv = pluginName + '.env';
	configCommit = pluginName + '.commit';
	regexLines = rxLines;
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
	Object.keys(env).forEach(function(key) {
		if (!env[key]) {
			env[key] = getv(key);
		}
		// use function to prevent accidental log leaking of tokens
		if (env[key] && regexToken.test(key)) {
			env[key] = token(env[key]);
		}
	});
	return genCommit(env);
}

/**
 * Initializes commit details and sets the results in the grunt configuration
 * using the plug-in name
 * 
 * @param env
 *            the global environment
 */
function genCommit(env) {
	grunt.config.set(configEnv, env);
	grunt.verbose.writeln('Global environment available via grunt.config.get("'
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
		var rtn = utils.execCmd(c, env.gitCliSubstitute);
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
	var pver = utils.execCmd('git describe --abbrev=0 --tags',
			env.gitCliSubstitute);
	var lverno = false;
	if (pver.code !== 0
			&& (!util.isRegExp(env.prevVersionMsgIgnoreRegExp) || !(lverno = env.prevVersionMsgIgnoreRegExp
					.test(pver.output)))) {
		throw new Error('Error capturing previous release version '
				+ pver.output);
	}
	if (!lverno && pver.output) {
		pver = pver.output.replace(regexVerLines, '');
		grunt.log.writeln('Found previous release version "' + pver
				+ '" from git');
	} else {
		pver = '';
		var pkg = grunt.file.readJSON(env.pkgPath);
		if (pkg.version) {
			pver = pkg.version;
			grunt.log.writeln('Found previous release version "' + pver
					+ '" from ' + env.pkgPath);
		}
	}
	var c = new Commit(env.releaseVersionRegExp, env.bumpVersionRegExp, cm,
			pver, true, env.gitCliSubstitute, ch, env.pkgPath, env.buildDir,
			br, rs, un, rn, env.gitToken, env.npmToken);
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
	var wl = [ c.skipTaskCheck, c.skipTaskGen, c.versionPkg ];
	var bl = [ c.versionMatch, c.gitCliSubstitute, c.pkgPath, undefined ];
	if (c.prev.versionMatch) {
		bl.push(c.prev.versionMatch);
	}
	if (c.next.versionMatch) {
		bl.push(c.next.versionMatch);
	}
	bl.push(c.prev.prev);
	bl.push(c.prev.next);
	bl.push(c.next.prev);
	bl.push(c.next.next);
	var cc = clone(c, wl, bl);
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
 *            an array of black list property values that will be excluded from
 *            the clone
 * @returns {Object} clone
 */
function clone(c, wl, bl) {
	var cl = {}, cp, t;
	for (var keys = Object.keys(c), l = 0; l < keys.length; l++) {
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
 * @param relRx
 *            the regular expression to use for matching a release on the commit
 *            message
 * @param bumpRx
 *            the regular expression to use for matching the next version on the
 *            commit message
 * @param cm
 *            the commit message string or object with a "message", an optional
 *            regular expression "matcher" to use to match on the message, an
 *            optional alternative message "altMessage" to use when no matches
 *            are found within the "message" and an alternative regular
 *            expression "altMatcher" to use when no matches are found within
 *            the "message")
 * @param pver
 *            an optional previous release version (or {Commit})
 * @param nver
 *            true to extract or generate the next version (or {Commit})
 * @param gitCliSubstitute
 *            the optional command replacement that will be substituted for the
 *            "git" CLI (when applicable)
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
function Commit(relRx, bumpRx, cmo, pver, nver, gitCliSubstitute, ch, pkgPath,
		buildDir, branch, slug, username, reponame, gitToken, npmToken) {
	var cm = typeof cmo === 'string' ? cmo : cmo.message;
	this.versionRegExp = typeof cmo === 'object' && cmo.matcher ? cmo.matcher
			: relRx;
	var rv = cm.match(this.versionRegExp);
	if ((!rv || !rv.length) && typeof cmo === 'object'
			&& typeof cmo.altMessage === 'string') {
		cm = cmo.altMessage;
		this.versionRegExp = cmo.altMatcher || cmo.matcher;
		rv = cm.match(this.versionRegExp);
	}
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
		for (var i = 0; i < arguments.length; i++) {
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
	this.versionPrevIndices = [];
	this.versionVacant = function() {
		return !this.versionMajor && !this.versionMinor && !this.versionPatch
				&& !this.versionPrerelease;
	};
	this.versionLabel = rv.length > 1 ? rv[1] : '';
	this.versionType = rv.length > 2 ? rv[2] : '';
	this.prev = pver instanceof Commit ? pver
			: typeof pver === 'string' ? new Commit(relRx, bumpRx,
					self.versionLabel + ' ' + self.versionType + pver, null,
					self) : {
				version : '0.0.0',
				versionMatch : []
			};
	this.versionPrereleaseType = rv.length > 10 ? verMatchVal(10, true) : '';
	this.versionMajor = rv.length > 4 ? verMatchVal(4) : 0;
	this.versionMinor = rv.length > 6 ? verMatchVal(6) : 0;
	this.versionPatch = rv.length > 8 ? verMatchVal(8) : 0;
	this.versionPrerelease = rv.length > 12 ? verMatchVal(12) : 0;
	this.version = this.versionPrevIndices.length
			|| this.versionBumpedIndices.length ? vver()
			: rv.length > 3 ? rv[3] : '';
	this.versionTag = rv.length > 3 ? rv[2] + this.version : '';
	this.versionPkg = function(replacer, space, revert, next, altWrite, cb,
			altPath) {
		var pkg = null;
		var pth = altPath || self.pkgPath;
		if (pth) {
			pkg = grunt.file.readJSON(pth);
			var u = pkg && !revert && !next && pkg.version !== self.version
					&& self.version;
			var n = pkg && !revert && next && pkg.version !== self.next.version
					&& self.next.version;
			var r = pkg && revert && self.prev.version;
			if (u || n || r) {
				var oldVer = pkg.version;
				pkg.version = r ? self.prev.version : n ? self.next.version
						: self.version;
				var pkgStr = JSON.stringify(pkg, replacer, space);
				grunt.file
						.write(pth, typeof altWrite === 'function' ? altWrite(
								pkg, pkgStr, oldVer, u, r, n, pth, replacer,
								space) : pkgStr);
				if (typeof cb === 'function') {
					cb(pkg, pkgStr, oldVer, u, r, n, pth, replacer, space);
				}
			}
		}
		return pkg;
	};
	this.versionValidate = function() {
		if (!validate(self.version)) {
			return false;
		} else if (self.prev.version
				&& semver.lte(self.version, self.prev.version)) {
			throw grunt.util.error(self.version
					+ ' must be higher than the previous release version '
					+ self.prev.version);
		} else if (self.next.version
				&& semver.gte(self.version, self.next.version)) {
			throw grunt.util.error(self.version
					+ ' must be lower than the next release version '
					+ self.next.version);
		}
		return true;
	};
	this.next = nver === true && this.version ? new Commit(relRx, bumpRx, {
		matcher : bumpRx,
		message : cm,
		altMatcher : relRx,
		altMessage : self.versionLabel + ' ' + vver(true, true)
	}, self) : nver instanceof Commit ? nver : {
		version : ''
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
	function verMatchVal(i, isPreType) {
		var v = self.versionMatch[i];
		var vr = isPreType ? '' : 0;
		var vl = self.prev.versionMatch && self.prev.versionMatch.length > i
				&& self.prev.versionMatch[i] ? isPreType ? self.prev.versionMatch[i]
				: parseInt(self.prev.versionMatch[i])
				: vr;
		si++;
		if (v && regexVerBump.test(v)) {
			// increment the value for the given slot
			self.versionBumpedIndices.push(si);
			var m = v.match(regexVerBump);
			if (isPreType) {
				vr = verPretype(vl, m.length);
			} else {
				vr = vl + m.length;
			}
		} else if (v && regexVerCurr.test(v)) {
			// use the last release value for the given slot
			self.versionPrevIndices.push(si);
			if (isPreType) {
				vr = verPretype(vl, 0);
			} else {
				vr = vl;
			}
		} else if (v) {
			vr = isPreType ? v : parseInt(v);
		}
		vt += vr;
		return vr;
	}
	function verPretype(vt, cnt) {
		vt = vt || preReleaseTypes[0];
		var i = preReleaseTypes.indexOf(vt.toLowerCase());
		var r = i >= 0 && i + cnt < preReleaseTypes.length - 1 ? preReleaseTypes[i
				+ cnt]
				: null;
		if (!r) {
			var msgt = cnt > 0 ? 'version bump: ' : 'last version extraction: ';
			throw grunt.util.error('Invalid prerelease ' + msgt + vt
					+ ' supported sequence: ' + preReleaseTypes.join(','));
		}
		return r;
	}
	function vver(pt, inc) {
		return (pt ? vv(2) : '')
				+ vv(4, self.versionMajor)
				+ vv(5)
				+ vv(6, self.versionMinor)
				+ vv(7)
				+ vv(8, self.versionPatch, inc && !self.versionPrereleaseType)
				+ vv(9)
				+ vv(10, self.versionPrereleaseType)
				+ vv(11)
				+ (self.versionPrereleaseType ? vv(12, self.versionPrerelease,
						inc) : '');
	}
	function vv(i, v, inc) {
		if (self.versionMatch.length > i) {
			if (typeof v !== 'undefined') {
				return inc && !isNaN(v) ? v + 1 : v;
			} else if (typeof self.versionMatch[i] !== 'undefined') {
				return self.versionMatch[i];
			}
		}
		return '';
	}
}