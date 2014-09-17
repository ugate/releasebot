'use strict';

var semver = require('semver');
var rbot = require('../releasebot');

var pack = module.exports = Pack;
pack.runtimeRequire = runtimeRequire;

/**
 * Pack constructor
 * 
 * @constructor
 * @param commit
 *            the commit instance
 * @param options
 *            the options
 * @param rollCall
 *            the roll call instance
 * @param command
 *            the command instance
 */
function Pack(commit, options, rollCall, command) {
	if (!commit || !options || !rollCall || !command) {
		throw new Error('Invalid arguments: ' + arguments);
	}
	this.commit = commit;
	this.options = options;
	this.rollCall = rollCall;
	this.command = command;
}

/**
 * Attempts to publish package contents to bower (if configured) then to npm (if
 * configured)
 */
Pack.prototype.publish = function publish() {
	registerBower(this);
};

/**
 * Searches the bower registry for bower package name and registers it if it
 * cannot be found. Loads the required bower module when needed.
 * 
 * @param pck
 *            the pack instance
 */
function registerBower(pck) {
	var pd = pck.commit.versionPkg({
		replacer : pck.options.pkgJsonReplacer,
		space : pck.options.pkgJsonSpace,
		readOnly : true
	});
	if (!pd || !pd.pkgBower) {
		rbot.log.info('Skipping bower registration check (no bower package found)');
		return pck.rollCall.then(npmPub);
	}
	var path = pd.pkgBower.path;
	var name = pd.pkgBower.name;
	var ver = pd.pkgBower.ver;
	var url = pd.pkgBower.repository && pd.pkgBower.repository.url ? pd.pkgBower.repository.url : '';
	if (!name || !url) {
		rbot.log.info('Skipping bower registration check '
				+ (name || ver || url ? 'for "' + (name ? ':name:' + name : ':NO name:')
						+ (ver ? ':version:' + ver : ':NO version:') + (url ? ':url:' + url : ':NO repository.url:')
						+ '" ' : '') + (!path ? '("' + path + '" cannot be read)' : 'in: ' + path));
		return pck.rollCall.then(npmPub);
	}
	var bower = null;
	try {
		bower = require('bower');
	} catch (e) {
		rbot.log.info('Skipping bower registration (bower module not found)', e);
		return pck.rollCall.then(npmPub);
	}
	pck.rollCall.pause(function bowerLookup() {
		bower.commands.lookup(name).on('error', function(e) {
			pck.rollCall.error('bower lookup failed', e).resume();
		}).on('end', bowerLookupEnd);
	});
	function bowerLookupEnd(data) {
		if (data) {
			if (data.url !== url) {
				pck.rollCall.error(
						'bower lookup found "' + name + '", but the repository.url found "' + data.url
								+ '" does not match the expected "' + path + '" repository.url "' + url + '"').resume();
			} else {
				rbot.log.verbose('found existing bower package for "' + name + '" at "' + data.url
						+ '"... no need to perform bower register');
			}
		} else {
			rbot.log.info('registering bower package "' + name + '"');
			pck.rollCall.pause(function bowerReg() {
				bower.commands.lookup(name, url).on('error', function(e) {
					pck.rollCall.error('bower registration failed', e).resume();
				}).on('end', bowerRegEnd);
			});
		}
	}
	function bowerRegEnd(data) {
		if (data) {
			rbot.log.info('bower registration complete');
			rbot.log.dir(data);
			pck.rollCall.then(npmPub).resume();
		} else {
			pck.rollCall.error('bower registration failed (no data received)').resume();
		}
	}
	function npmPub() {
		publishNpm(pck);
	}
}

/**
 * npm publish
 * 
 * @param pck
 *            the pack instance
 */
function publishNpm(pck) {
	var pkg = null, auth = [], npm = null;
	if (pck.commit.hasNpmToken && pck.commit.pkgPath) {
		try {
			npm = require('npm');
		} catch (e) {
			pck.rollCall.error('npm publish failed because npm module is not found (use "npm link npm")', e).resume();
			return;
		}
		rbot.log.info('Publishing to npm');
		go();
	} else {
		rbot.log.verbose('Skipping npm publish for ' + pck.commit.pkgPath + ' version ' + pck.commit.version);
	}
	function go() {
		var pd = pck.commit.versionPkg({
			replacer : pck.options.pkgJsonReplacer,
			space : pck.options.pkgJsonSpace,
			readOnly : true
		});
		pkg = pd.pkg;
		if (!pkg || !pkg.author || !pkg.author.email) {
			pck.rollCall.error('npm publish failed due to missing author.email in ' + pck.commit.pkgPath);
		} else {
			auth = (typeof pck.commit.npmToken === 'function' ? pck.commit.npmToken() : pck.commit.npmToken);
			auth = typeof auth === 'string' && (auth = new Buffer(auth, 'base64').toString()) ? auth.split(':') : [];
			if (auth.length !== 2) {
				pck.rollCall.error('npm NPM_TOKEN is missing or invalid');
			} else {
				pck.rollCall.pause(function() {
					npm.load({}, function(e) {
						if (e) {
							pck.rollCall.error('npm load failed', e).resume();
						} else {
							pck.rollCall.pause(adduser);
						}
					});
				});
			}
		}
	}
	function adduser() {
		npm.config.set('email', pkg.author.email, 'user');
		npm.registry.adduser(pck.options.npmRegistryURL, auth[0], auth[1], pkg.author.email, aucb);
		function aucb(e) {
			if (e) {
				pck.rollCall.error('npm publish failed to be authenticated', e).resume();
			} else {
				pck.rollCall.pause(pub);
			}
		}
	}
	function pub() {
		var pargs = [];
		if (pck.options.npmTag) {
			pargs.push('--tag ' + pck.options.npmTag);
		}
		rbot.log.info('npm publish ' + pargs.join(' '));
		// switch to the master branch so publish will pickup the right version
		pck.command.chkoutCmd(pck.commit.branch);
		npm.commands.publish(pargs, function(e) {
			if (e) {
				pck.rollCall.error('npm publish failed', e).resume();
			} else {
				pck.rollCall.pause(postPub);
			}
		});
		function postPub() {
			pck.command.chkoutRun(null, function() {
				rbot.log.verbose('npm publish complete');
				pck.rollCall.resume();
			});
		}
	}
}

/**
 * Installs an npm module at runtime (if needed)... because not all modules need
 * to be loaded/installed at build-time
 * 
 * @param mod
 *            the module name
 * @param at
 *            the optional version, version range or tag name to install
 * @param tryLink
 *            true to try to npm link a global installation before installing
 *            locally (if needed)
 * @param logLevel
 *            the optional npm log level used for the install
 * @param cb
 *            the callback function([module object] [, error])
 */
function runtimeRequire(mod, at, tryLink, logLevel, cb) {
	if (typeof cb !== 'function') {
		throw new Error('Invlaid callback: ' + cb);
	}
	try {
		return cb(require(mod));
	} catch (e) {
		// consume
	}
	var modf = mod + (at ? '@' + at : '');
	rbot.log.verbose('attempting to ' + (tryLink ? 'link/' : '') + 'install ' + modf);
	var npm = require('npm');
	npm.load({
		save : false,
		loglevel : logLevel || 'silent'
	}, function npmLoaded(e) {
		if (e) {
			return cb(null, e);
		}
		if (tryLink) {
			npm.commands.link([ mod ], function npmLinkCb(e) {
				if (e) {
					rbot.log.verbose('unable to "npm link ' + mod + '" Reason: ' + e.message);
					return install();
				}
				if (semver.valid(at)) {
					var pth = require('path').join(require.resolve(mod), '..', 'package.json');
					rbot.log.verbose('looking for ' + pth);
					var npmpkg = null;
					try {
						npmpkg = require(pth);
					} catch (e2) {
						rbot.log.verbose('no package.json found under ' + pth + ' Reason: ' + e2.message);
						return install();
					}
					if (!semver.satisfies(npmpkg.version, at)) {
						rbot.log.verbose('linked ' + mod + '@' + npmpkg.version
								+ ' does not match the expected version: ' + at);
						return install();
					}
				}
				cb(require(mod));
			});
		} else {
			install();
		}
	});
	function install() {
		npm.commands.install([ modf ], function npmInstallCb(e) {
			cb(e ? null : require(mod), e);
		});
	}
}