'use strict';

var semver = require('semver');
var util = require('util');
var utils = require('./utils');
var charVerMeta = '+';
var regexVerCurr = /\*/g;
var regexVerBump = /\++/g;
var regexVerLast = /\d+(?=[^\d]*$)/;
var regexVerNum = /\d+/g;
var regexVerCurrBumpNum = new RegExp('(' + regexVerCurr.source + ')|('
		+ regexVerBump.source + ')|(' + regexVerNum.source + ')', 'g');
var regexSkips = /\[\s?skip\s+(.+)\]/gmi;
var regexSlug = /^(?:.+\/)(.+\/[^\.]+)/;
var regexVerLines = /^v|(\r?\n)/g;
var regexKeyVal = /="(.+)"$/;
var regexToken = /token$/i;
var grunt = null, pluginName = '', envNS = '', commitNS = '', regexLines = '';
var committer = exports;
committer.init = initEnv;
committer.cloneAndSetCommit = cloneAndSetCommit;
committer.getCommit = getCommit;
committer.getEnv = getEnv;
committer.skipTaskGen = skipTaskGen;

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
 * @param msg
 *            alternative verbose message (null prevents log output)
 * @param ns
 *            an optional namespace to use for the globally initiated commit
 * @param prevVer
 *            optional previous version (overrides capture)
 * @returns {Commit}
 */
function initEnv(grnt, name, rxLines, env, msg, ns, prevVer) {
	grunt = grnt;
	pluginName = name;
	envNS = pluginName + '.env';
	commitNS = pluginName + '.commit';
	regexLines = rxLines;
	var gconfig = getEnv() || {};
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
		regexToken.lastIndex = 0;
		if (env[key] && regexToken.test(key)) {
			env[key] = token(env[key]);
		}
	});
	return genCommit(env, msg, ns, prevVer);
}

/**
 * Initializes commit details and sets the results in the grunt configuration
 * using the plug-in name
 * 
 * @param env
 *            the global environment
 * @param msg
 *            alternative verbose message (null prevents log output)
 * @param ns
 *            an optional namespace to use for the globally initiated commit
 * @param prevVer
 *            optional previous version (overrides capture)
 */
function genCommit(env, msg, ns, prevVer) {
	grunt.config.set(envNS, env);
	var gmsg = typeof msg === 'string' ? msg + '\n'
			: typeof msg === 'undefined' ? 'Global environment available via grunt.config.get("'
					+ envNS + '"):\n'
					: msg;
	if (gmsg) {
		grunt.verbose.writeln(gmsg + util.inspect(env, {
			colors : true,
			depth : 3
		}));
	}
	// use global commit to prevent duplicate lookups
	var gc = getCommit();
	/*
	 * grunt.verbose.writeln(gc ? 'Global commit\n' + util.inspect(gc, { colors :
	 * true, depth : 3 }) : 'no global commit set yet...');
	 */
	var ch = gc ? gc.hash : env.hash;
	var cm = env.commitMessage ? env.commitMessage : gc ? gc.message : null;
	var br = gc ? gc.branch : env.branch;
	var rs = gc ? gc.slug : env.repoSlug;
	var pver = prevVer ? prevVer : gc && gc.prev ? gc.prev.version : null;
	var un = '', rn = '';
	if (!gc) {
		grunt.verbose.writeln('Searching for commit details...');
	}
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
	function smv(cm, rx, pv) {
		if (!util.isRegExp(rx)) {
			return cm;
		}
		return cm.replace(rx, function relSemver(m, lbl, sep, typ, rel) {
			return lbl + sep + typ + semver.inc(pv, rel);
		});
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
		if (rs) {
			grunt.verbose.writeln('Found repo slug: "' + rs + '"');
		}
	} else {
		sur(rs);
	}
	if (!pver) {
		pver = utils.execCmd('git describe --abbrev=0 --tags',
				env.gitCliSubstitute);
		var lverno = false;
		if (pver.code !== 0) {
			var pvmire = util.isRegExp(env.prevVersionMsgIgnoreRegExp);
			if (pvmire) {
				env.prevVersionMsgIgnoreRegExp.lastIndex = 0;
				lverno = env.prevVersionMsgIgnoreRegExp.test(pver.output);
				pvmire = lverno;
			}
			if (!pvmire) {
				throw new Error('Error capturing previous release version '
						+ pver.output);
			}
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
			} else {
				var pve = 'Missing version from "' + env.pkgPath + '" using '
						+ pver;
				grunt.fail.warn(pve);
				throw new Error(pve);
			}
		}
	}
	if (cm) {
		// replace any release or bump version templates with the incremented
		// versions from the semver (should be performed before explicit check)
		cm = smv(cm, env.releaseVersionSemverIncRegExp, pver);
		cm = smv(cm, env.bumpVersionSemverIncRegExp, pver);
	}
	var c = new Commit(env.releaseVersionDefaultLabel,
			env.releaseVersionDefaultType, env.releaseVersionRegExp,
			env.bumpVersionRegExp, cm, pver, true, env.gitCliSubstitute, ch,
			env.pkgPath, env.buildDir, br, rs, un, rn, env.gitToken,
			env.npmToken);
	cloneAndSetCommit(c, msg);
	return c;
}

/**
 * Clones a {Commit} and sets the cloned value in the Grunt configuration
 * 
 * @param c
 *            the {Commit} to clone/set (null will remove set {Commit})
 * @param msg
 *            alternative verbose message (null prevents log output)
 * @param ns
 *            an optional namespace to use for the commit
 */
function cloneAndSetCommit(c, msg, ns) {
	var cns = getCommitNS(ns);
	if (!c) {
		grunt.config.set(cns, null);
		return;
	}
	var wl = [ c.skipTaskCheck, c.skipTaskGen, c.versionPkg ];
	var bl = [ undefined ];
	if (c.versionMatch) {
		bl.push(c.versionMatch);
	}
	if (c.gitCliSubstitute) {
		bl.push(c.gitCliSubstitute);
	}
	if (c.pkgPath) {
		bl.push(c.pkgPath);
	}
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
	grunt.config.set(cns, cc);
	var cmsg = typeof msg === 'string' ? msg + '\n'
			: typeof msg === 'undefined' ? 'The following read-only object is now accessible via grunt.config.get("'
					+ cns + '"):\n'
					: msg;
	if (cmsg) {
		grunt.verbose.writeln(cmsg + util.inspect(cc, {
			colors : true,
			depth : 3
		}));
		// grunt.log.writeflags(c, msg);
	}
}

/**
 * Gets the global {Commit} previously set in the Grunt configuration
 * 
 * @param ns
 *            the optional namespace to use
 * @returns the {Commit}
 */
function getCommit(ns) {
	return grunt ? grunt.config.get(getCommitNS(ns)) : null;
}

/**
 * Gets the namespace used for a {Commit}
 * 
 * @param ns
 *            the optional namespace to use
 * @returns the namespace
 */
function getCommitNS(ns) {
	return ns ? commitNS + (ns === commitNS ? '' : '.' + ns) : commitNS;
}

/**
 * Gets the environment in which the commits are generated
 * 
 * @returns the commit environment
 */
function getEnv() {
	return grunt ? grunt.config.get(envNS) : null;
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
 * @param relLbl
 *            the default release label to use when a release match is not found
 * @param relType
 *            the default release type to use when a release match is not found
 * @param relRx
 *            the regular expression to use for matching a release on the commit
 *            message
 * @param bumpRx
 *            the regular expression to use for matching the next version on the
 *            commit message
 * @param cmo
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
 * @param ch
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
function Commit(relLbl, relType, relRx, bumpRx, cmo, pver, nver,
		gitCliSubstitute, ch, pkgPath, buildDir, branch, slug, username,
		reponame, gitToken, npmToken) {
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
		return committer.skipTaskGen(false, arguments);
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
		return isNaN(this.versionMajor) && isNaN(this.versionMinor)
				&& isNaN(this.versionPatch) && !this.versionPrerelease;
	};
	this.versionLabel = rv.length > 1 ? rv[1] : '';
	this.versionLabelSep = rv.length > 2 ? rv[2] : '';
	this.versionType = rv.length > 3 ? rv[3] : '';
	this.prev = pver instanceof Commit ? pver
			: typeof pver === 'string' ? new Commit(relLbl, relType, relRx,
					bumpRx, (self.versionLabel || relLbl)
							+ (self.versionLabelSep || ' ')
							+ (self.versionType || relType) + pver, null, self)
					: {
						version : '0.0.0',
						versionMatch : []
					};
	this.versionPrereleaseChar = rv.length > 10 ? rv[10] : '';
	this.versionMajor = rv.length > 5 ? verMatchVal(5) : 0;
	this.versionMinor = rv.length > 7 ? verMatchVal(7) : 0;
	this.versionPatch = rv.length > 9 ? verMatchVal(9) : 0;
	var versionSuffix = verSuffix(11);
	this.versionPrerelease = versionSuffix.prerelease;
	this.versionMetadata = versionSuffix.metadata;
	this.version = this.versionPrevIndices.length
			|| this.versionBumpedIndices.length ? vver()
			: rv.length > 4 ? rv[4] : '';
	this.versionTag = rv.length > 4 ? rv[3] + this.version : '';
	this.versionTrigger = vmtchs(1, 11, [ 4 ]);
	this.versionPkg = function(replacer, space, revert, next, altWrite, cb,
			altPath) {
		var pkg = null, pkgStr = '', oldVer = '', u = null, n = null, r = null;
		var pth = altPath || self.pkgPath;
		if (pth) {
			pkg = grunt.file.readJSON(pth);
			u = pkg && !revert && !next && pkg.version !== self.version
					&& self.version;
			n = pkg && !revert && next && pkg.version !== self.next.version
					&& self.next.version;
			r = pkg && revert && self.prev.version;
			if (u || n || r) {
				oldVer = pkg.version;
				pkg.version = r ? self.prev.version : n ? self.next.version
						: self.version;
				pkgStr = JSON.stringify(pkg, replacer, space);
				grunt.file
						.write(pth, typeof altWrite === 'function' ? altWrite(
								pkg, pkgStr, oldVer, u, r, n, pth, replacer,
								space) : pkgStr);
			}
		}
		if (typeof cb === 'function') {
			cb(pkg, pkgStr, oldVer, u, r, n, pth, replacer, space);
		}
		return pkg;
	};
	this.versionValidate = function() {
		if (!validate(self.version)) {
			return false;
		} else if (self.prev.version
				&& semver.gte(self.prev.version, self.version)) {
			throw grunt.util.error(self.version
					+ ' must be higher than the previous release version '
					+ self.prev.version);
		} else if (self.next.version
				&& semver.lte(self.next.version, self.version)) {
			throw grunt.util.error(self.version
					+ ' must be lower than the next release version '
					+ self.next.version);
		}
		return true;
	};
	this.next = nver === true && this.version ? new Commit(relLbl, relType,
			relRx, bumpRx, {
				matcher : bumpRx,
				message : cm,
				altMatcher : relRx,
				altMessage : (self.versionLabel || relLbl)
						+ (self.versionLabelSep || ' ') + vver(true, true)
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
	// parse out bump/current version characters from version slot
	function verMatchVal(i) {
		var v = self.versionMatch[i];
		var vr = 0;
		var vl = self.prev.versionMatch && self.prev.versionMatch.length > i
				&& self.prev.versionMatch[i] ? +self.prev.versionMatch[i] : vr;
		si++;
		// reset the last index so the tests will be accurate
		regexVerBump.lastIndex = 0;
		regexVerCurr.lastIndex = 0;
		if (v && regexVerBump.test(v)) {
			// increment the value for the given slot
			self.versionBumpedIndices.push(si);
			var bcnt = 0;
			v.replace(regexVerBump, function vBump(m) {
				bcnt += m.length;
			});
			vr = vl + bcnt;
		} else if (v && regexVerCurr.test(v)) {
			// use the last release value for the given slot
			self.versionPrevIndices.push(si);
			vr = vl;
		} else if (v) {
			// faster parseInt using unary operator
			vr = +v;
		}
		vt += vr;
		return vr;
	}
	// parse out bump/current version characters from prerelease/metadata
	function verSuffix(i) {
		var rtn = {
			prerelease : '',
			metadata : '',
			prereleaseVersions : null
		};
		if (self.versionMatch.length <= i) {
			return rtn;
		}
		var v = self.versionMatch[i];
		// reset the last index so the tests will be accurate
		regexVerCurrBumpNum.lastIndex = 0;
		// replace place holders with current or bumped version
		var vi = -1;
		var pvers = self.prev && self.prev.versionPrerelease
				&& self.prev.versionPrerelease.match(regexVerNum);
		var mdi = v.lastIndexOf(charVerMeta);
		var lsti = v.length - 1;
		v = v.replace(regexVerCurrBumpNum, function verCurrRepl(m, cg, bg, ng,
				off) {
			vi++;
			if (ng) {
				return m;
			}
			if (cg) {
				// match previous rerelease version slots with the current place
				// holder slot (if any)
				self.versionPrevIndices.push(++si);
				return pvers && pvers.length > vi ? pvers[vi] : 0;
			} else if (bg) {
				// only increment when the bump is not the last instance or is
				// the last instance, but there is metadata following its
				// occurrence
				if (mdi === lsti || mdi !== off
						|| (off + m.length - 1) === lsti) {
					self.versionBumpedIndices.push(++si);
					return (pvers && pvers.length > vi ? +pvers[vi] : 0)
							+ m.length;
				}
			}
			return m;
		});
		// separate metadata from the prerelease
		mdi = v.indexOf(charVerMeta);
		if (mdi >= 0) {
			rtn.prerelease = mdi === 0 ? '' : v.substring(0, mdi);
			rtn.metadata = v.substring(mdi);
		} else {
			rtn.prerelease = v;
		}
		return rtn;
	}
	// reconstruct version w/optional incrementation
	function vver(pt, inc) {
		return (pt ? vv(3) : '')
				+ vv(5, self.versionMajor)
				+ vv(6)
				+ vv(7, self.versionMinor)
				+ vv(8)
				+ vv(9, self.versionPatch, inc && !self.versionPrereleaseChar)
				+ vv(10)
				+ vv(11, self.versionPrerelease, inc
						&& self.versionPrereleaseChar)
				+ vv(12, self.versionMetadata);
	}
	// gets a version slot based upon a match index or passed value w/optional
	// incrementation
	function vv(i, v, inc) {
		var vn = !isNaN(v);
		var nv = vn ? v : v || self.versionMatch[i] || '';
		if (inc && vn) {
			return +nv + 1;
		} else if (inc) {
			// increment the last numeric value sequence
			return nv.replace(regexVerLast, function vvInc(m) {
				return +m + 1;
			});
		}
		return nv;
	}
	// reconstructs the version matches
	function vmtchs(start, end, skips) {
		var s = '';
		for (var i = start; i <= end; i++) {
			if (skips && skips.indexOf(i) >= 0) {
				continue;
			}
			s += self.versionMatch[i] || '';
		}
		return s;
	}
}

/**
 * Generates syntax for skipping a task(s)
 * 
 * @param forRegExp
 *            true if the result should be for regular expression inclusion
 * @param arr
 *            {Array} of task names to generate skip indicators for (supports
 *            nested {Array}s)
 * @returns skip task string
 */
function skipTaskGen(forRegExp, arr, cobj) {
	var s = '';
	var a = Array.isArray(arr) ? arr : arr && typeof arr === 'string' ? [ arr ]
			: null;
	if (a) {
		var c = cobj || {
			cnt : 0,
			ttl : 0,
			isLast : function() {
				return this.cnt < this.ttl;
			}
		};
		c.ttl += a.length;
		for (var i = 0; i < a.length; i++) {
			if (Array.isArray(a[i])) {
				c.ttl--;
				s += skipTaskGen(forRegExp, a[i], c);
			} else if (a[i]) {
				c.cnt++;
				s += (forRegExp ? '(?:\\' : '') + '[skip ' + a[i]
						+ (forRegExp ? '\\' : '') + ']'
						+ (forRegExp ? ')' + (c.isLast() ? '|' : '') : '');
			}
		}
	}
	return s;
}