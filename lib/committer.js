'use strict';

var semver = require('semver');
var util = require('util');
var execCmd = require('./cmd').execCmd;
var rbot = require('../releasebot');

var charVerMeta = '+';
var regexVerCurr = /\*/g;
var regexVerBump = /\++/g;
var regexVerLast = /\d+(?=[^\d]*$)/;
var regexVerNum = /\d+/g;
var regexVerCurrBumpNum = new RegExp('(' + regexVerCurr.source + ')|(' + regexVerBump.source + ')|('
		+ regexVerNum.source + ')', 'g');
var regexSkips = /\[\s?skip\s+(.+)\]/gmi;
var regexSlug = /^(?:.+\/)(.+\/[^\.]+)/;
var regexVerLines = /^v|(\r?\n)/g;
var regexKeyVal = /="(.+)"$/;
var regexToken = /token$/i;
var pluginName = '', envNS = '', commitNS = '', regexLines = '';
var committer = exports;
committer.init = initEnv;
committer.cloneAndSetCommit = cloneAndSetCommit;
committer.getCommit = getCommit;
committer.getEnv = getEnv;
committer.skipTaskGen = skipTaskGen;

/**
 * Initializes the global environment and returns {Commit} related data
 * 
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
 * @param noVerbose
 *            true to prevent logging of detailed information about the
 *            generated commit and commit environment
 * @returns {Commit}
 */
function initEnv(name, rxLines, env, msg, ns, prevVer, noVerbose) {
	pluginName = name;
	envNS = pluginName + '.env';
	commitNS = pluginName + '.commit';
	regexLines = rxLines;
	var gconfig = getEnv() || {};
	var nargv = null;
	// find via node CLI argument in the format key="value"
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
		return gconfig[k] || rbot.option(pluginName + '.' + k) || argv(pluginName + '.' + k) || '';
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
	return genCommit(env, msg, ns, prevVer, noVerbose);
}

/**
 * Initializes commit details and sets the results in the releasebot
 * configuration using the plug-in name
 * 
 * @param env
 *            the global environment
 * @param msg
 *            alternative verbose message (null prevents log output)
 * @param ns
 *            an optional namespace to use for the globally initiated commit
 * @param prevVer
 *            optional previous version (overrides capture)
 * @param noVerbose
 *            true to prevent logging of detailed information about the
 *            generated commit and commit environment
 * @returns {Commit}
 */
function genCommit(env, msg, ns, prevVer, noVerbose) {
	rbot.config(envNS, env);
	if (!noVerbose) {
		var gmsg = typeof msg === 'string' ? msg + '\n'
				: typeof msg === 'undefined' ? 'Global environment available via releasebot.config("' + envNS + '"):\n'
						: msg;
		if (gmsg) {
			rbot.log.verbose(gmsg + util.inspect(env, {
				colors : true,
				depth : 3
			}));
		}
	}
	// use global commit to prevent duplicate lookups
	var gc = getCommit();
	/*
	 * rbot.log.verbose(gc ? 'Global commit\n' + util.inspect(gc, { colors :
	 * true, depth : 3 }) : 'no global commit set yet...');
	 */
	var ch = gc ? gc.hash : env.hash;
	var cm = env.commitMessage ? env.commitMessage : gc ? gc.message : null;
	var br = gc ? gc.branch : env.branch;
	var rs = gc ? gc.slug : env.repoSlug;
	var pver = prevVer ? prevVer : gc && gc.prev ? gc.prev.version : null;
	var un = '', rn = '';
	if (!gc) {
		rbot.log.verbose('Searching for commit details...');
	}
	function cmd(c) {
		var rtn = execCmd(c, env.gitCliSubstitute);
		if (rtn.code !== 0) {
			var e = new Error('Error "' + rtn.code + '" for ' + c + ' ' + rtn.output);
			rbot.log.error(e);
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
		rbot.log.verbose('Found branch: "' + br + '"');
	}
	if (!ch) {
		ch = cmd('git rev-parse HEAD');
		rbot.log.verbose('Found commit hash: "' + ch + '"');
	}
	if (!cm) {
		// fall back on either last commit message or the commit message for
		// the current commit hash
		cm = cmd("git show -s --format=%B " + env.commitHash);
		rbot.log.verbose('Found commit message: "' + cm + '"');
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
			rbot.log.verbose('Found repo slug: "' + rs + '"');
		}
	} else {
		sur(rs);
	}
	if (!pver) {
		pver = execCmd('git describe --abbrev=0 --tags', env.gitCliSubstitute);
		var lverno = false;
		if (pver.code !== 0) {
			var pvmire = util.isRegExp(env.prevVersionMsgIgnoreRegExp);
			if (pvmire) {
				env.prevVersionMsgIgnoreRegExp.lastIndex = 0;
				lverno = env.prevVersionMsgIgnoreRegExp.test(pver.output);
				pvmire = lverno;
			}
			if (!pvmire) {
				throw new Error('Error capturing previous release version ' + pver.output);
			}
		}
		if (!lverno && pver.output) {
			pver = pver.output.replace(regexVerLines, '');
			rbot.log.info('Found previous release version "' + pver + '" from git');
		} else {
			pver = '';
			var pkg = rbot.file.readJSON(env.pkgPath);
			if (pkg.version) {
				pver = pkg.version;
				rbot.log.info('Found previous release version "' + pver + '" from ' + env.pkgPath);
			} else {
				var pve = 'Missing version from "' + env.pkgPath + '" using ' + pver;
				rbot.log.fail(pve);
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
	var c = new Commit(env.releaseVersionDefaultLabel, env.releaseVersionDefaultType, env.releaseVersionRegExp,
			env.bumpVersionRegExp, cm, pver, true, env.gitCliSubstitute, ch, env.pkgPath, env.pkgPathBower,
			env.pkgPropSync, env.buildDir, br, rs, un, rn, env.gitToken, env.npmToken);
	cloneAndSetCommit(c, msg, ns, noVerbose);
	return c;
}

/**
 * Clones a {Commit} and sets the cloned value in the task configuration
 * 
 * @param c
 *            the {Commit} to clone/set (null will remove set {Commit})
 * @param msg
 *            alternative verbose message (null prevents log output)
 * @param ns
 *            an optional namespace to use for the commit
 * @param noVerbose
 *            true to prevent logging of detailed information about the cloned
 *            commit
 */
function cloneAndSetCommit(c, msg, ns, noVerbose) {
	var cns = getCommitNS(ns);
	if (!c) {
		rbot.config(cns, null);
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
	if (c.pkgPathBower) {
		bl.push(c.pkgPathBower);
	}
	if (c.pkgPropSync) {
		bl.push(c.pkgPropSync);
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
	rbot.config(cns, cc);
	if (!noVerbose) {
		var cmsg = typeof msg === 'string' ? msg + '\n'
				: typeof msg === 'undefined' ? 'The following read-only object is now accessible via releasebot.config("'
						+ cns + '"):\n'
						: msg;
		if (cmsg) {
			rbot.log.verbose(cmsg + util.inspect(cc, {
				colors : true,
				depth : 3
			}));
			// rbot.log.dir(c, msg);
		}
	}
}

/**
 * Gets the global {Commit} previously set in the task configuration
 * 
 * @param ns
 *            the optional namespace to use
 * @returns the {Commit}
 */
function getCommit(ns) {
	return rbot.config(getCommitNS(ns));
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
	return rbot.config(envNS);
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
		} else if (cp == null || t === 'string' || t === 'number' || t === 'boolean' || util.isRegExp(cp)
				|| util.isDate(cp) || util.isError(cp)) {
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
 * @param pkgPathBower
 *            the path to the bower package file
 * @param pkgPropSync
 *            the array of properties to synchronize between packages
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
function Commit(relLbl, relType, relRx, bumpRx, cmo, pver, nver, gitCliSubstitute, ch, pkgPath, pkgPathBower,
		pkgPropSync, buildDir, branch, slug, username, reponame, gitToken, npmToken) {
	var cm = typeof cmo === 'string' ? cmo : cmo.message;
	this.versionRegExp = typeof cmo === 'object' && cmo.matcher ? cmo.matcher : relRx;
	var rv = cm.match(this.versionRegExp);
	if ((!rv || !rv.length) && typeof cmo === 'object' && typeof cmo.altMessage === 'string') {
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
	this.pkgPathBower = pkgPathBower;
	this.pkgPropSync = pkgPropSync;
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
		return committer.skipTaskGen(false, Array.prototype.slice.call(arguments, 0));
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
	this.hasGitToken = typeof gitToken === 'function' ? gitToken().length > 0 : typeof gitToken === 'string'
			&& gitToken.length > 0;
	this.hasNpmToken = typeof npmToken === 'function' ? npmToken().length > 0 : typeof npmToken === 'string'
			&& npmToken.length > 0;
	this.message = cm;
	this.versionMatch = rv;
	this.versionBumpedIndices = [];
	this.versionPrevIndices = [];
	this.versionVacant = function() {
		return isNaN(this.versionMajor) && isNaN(this.versionMinor) && isNaN(this.versionPatch)
				&& !this.versionPrerelease;
	};
	this.versionLabel = rv.length > 1 ? rv[1] : '';
	this.versionLabelSep = rv.length > 2 ? rv[2] : '';
	this.versionType = rv.length > 3 ? rv[3] : '';
	this.prev = pver instanceof Commit ? pver : typeof pver === 'string' ? new Commit(relLbl, relType, relRx, bumpRx,
			(self.versionLabel || relLbl) + (self.versionLabelSep || ' ') + (self.versionType || relType) + pver, null,
			self) : {
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
	this.version = this.versionPrevIndices.length || this.versionBumpedIndices.length ? vver() : rv.length > 4 ? rv[4]
			: '';
	this.versionTag = rv.length > 4 ? rv[3] + this.version : '';
	this.versionTrigger = vmtchs(1, 11, [ 4 ]);
	this.versionPkg = function(opts, cb) {
		var pth = opts.altPkgPath || self.pkgPath || pkgPath;
		var pthb = opts.altPkgPathBower || self.pkgPathBower || pkgPathBower;
		var pkgp = self.pkgPropSync || pkgPropSync;
		// update package (if needed)
		var pd = pkgUpdate(pth);
		// update bower package when any of the sync properties do not match
		// what's in the master package
		var pdb = pkgUpdate(pthb, pd, pkgp);
		if (typeof cb === 'function') {
			cb(pd, pdb);
		}
		return {
			pkg : pd,
			pkgBower : pdb
		};
		// updates a package for a given path, parent package data (from
		// previous call to same function)
		// an optional array of properties to match can be passed that will be
		// matched against the parent package
		function pkgUpdate(pth, prt, props) {
			var rtn = {
				path : pth || '',
				props : Array.isArray(props) ? props : null,
				oldVer : '',
				version : '',
				propChangeCount : 0
			};
			if (!rtn.path) {
				return rtn;
			}
			rtn.pkg = rbot.file.readJSON(rtn.path);
			rtn.pkgParent = prt;
			rtn.oldVer = rtn.pkg.version;
			rtn.u = !opts.revert && !opts.next && pkgPropUpd(rtn, true, false, false);
			rtn.n = !opts.revert && opts.next && pkgPropUpd(rtn, false, true, false);
			rtn.r = opts.revert && pkgPropUpd(rtn, false, false, true);
			if (rtn.u || rtn.n || rtn.r) {
				if (rtn.propChangeCount > 0) {
					rtn.pkgStr = JSON.stringify(rtn.pkg, opts.replacer, opts.space);
					if (!opts.readOnly) {
						rbot.file.write(rtn.path, typeof opts.altWrite === 'function' ? opts.altWrite(rtn,
								opts.replacer, opts.space) : rtn.pkgStr);
					}
				}
			}
			return rtn;
		}
		// updates the package version or a set of properties from a parent
		// package for a given package data element and flag
		function pkgPropUpd(pd, u, n, r) {
			var v = null;
			if (u && pd.oldVer !== self.version && self.version) {
				v = self.version;
			} else if (n && pd.oldVer !== self.next.version && self.next.version) {
				v = self.next.version;
			} else if (r && self.prev.version) {
				v = self.prev.version;
			}
			pd.version = v;
			if (v && !pd.props) {
				pd.pkg.version = v;
				pd.propChangeCount++;
			}
			if (pd.props && pd.pkgParent) {
				pd.props.forEach(function pkgProp(p) {
					if (pd.pkgParent[p] && (!pd.pkg[p] || pd.pkgParent[p] !== pd.pkg[p])) {
						// sync parent package property with the current one
						pd.pkg[p] = pd.pkgParent[p];
						pd.propChangeCount++;
					}
				});
			}
			return v;
		}
	};
	this.versionValidate = function() {
		if (!validate(self.version)) {
			return false;
		} else if (self.prev.version && semver.gte(self.prev.version, self.version)) {
			throw new Error(self.version + ' must be higher than the previous release version ' + self.prev.version);
		} else if (self.next.version && semver.lte(self.next.version, self.version)) {
			throw new Error(self.version + ' must be lower than the next release version ' + self.next.version);
		}
		return true;
	};
	this.next = nver === true && this.version ? new Commit(relLbl, relType, relRx, bumpRx, {
		matcher : bumpRx,
		message : cm,
		altMatcher : relRx,
		altMessage : (self.versionLabel || relLbl) + (self.versionLabelSep || ' ') + vver(true, true)
	}, self) : nver instanceof Commit ? nver : {
		version : ''
	};
	function validate(v, q) {
		if (!v) {
			if (!q) {
				rbot.log.verbose('Non-release commit ' + (v || ''));
			}
			return false;
		} else if (!self.hasGitToken) {
			throw new Error('No Git token found, version: ' + v);
		} else if (!semver.valid(v)) {
			throw new Error('Invalid release version: ' + v);
		}
		return true;
	}
	// parse out bump/current version characters from version slot
	function verMatchVal(i) {
		var v = self.versionMatch[i];
		var vr = 0;
		var vl = self.prev.versionMatch && self.prev.versionMatch.length > i && self.prev.versionMatch[i] ? +self.prev.versionMatch[i]
				: vr;
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
		var pvers = self.prev && self.prev.versionPrerelease && self.prev.versionPrerelease.match(regexVerNum);
		var mdi = v.lastIndexOf(charVerMeta);
		var lsti = v.length - 1;
		v = v.replace(regexVerCurrBumpNum, function verCurrRepl(m, cg, bg, ng, off) {
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
				if (mdi === lsti || mdi !== off || (off + m.length - 1) === lsti) {
					self.versionBumpedIndices.push(++si);
					return (pvers && pvers.length > vi ? +pvers[vi] : 0) + m.length;
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
		return (pt ? vv(3) : '') + vv(5, self.versionMajor) + vv(6) + vv(7, self.versionMinor) + vv(8)
				+ vv(9, self.versionPatch, inc && !self.versionPrereleaseChar) + vv(10)
				+ vv(11, self.versionPrerelease, inc && self.versionPrereleaseChar) + vv(12, self.versionMetadata);
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
 *            task name or {Array} of task names to generate skip indicators for
 *            (supports nested {Array}s)
 * @returns skip task string
 */
function skipTaskGen(forRegExp, arr, cobj) {
	var s = '';
	var a = Array.isArray(arr) ? arr : arr && typeof arr === 'string' ? [ arr ] : null;
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
				s += (forRegExp ? '(?:\\' : '') + '[skip ' + a[i] + (forRegExp ? '\\' : '') + ']'
						+ (forRegExp ? ')' + (c.isLast() ? '|' : '') : '');
			}
		}
	}
	return s;
}