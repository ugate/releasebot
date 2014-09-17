var coopt = require('../lib/coopt');

/**
 * Global configuration tests
 */
exports.globals = {
	options : function(test) {
		var o = coopt.getEnv();
		test.ok(o, 'Cannot find release environment');

		test.ok(o.pkgPath, 'Cannot find options.pckPath');
		test.ok(o.buildDir, 'Cannot find options.buildDir');

		var ght = typeof o.gitToken === 'function' ? o.gitToken() : o.gitToken;
		test.ok(typeof ght === 'string' && ght.length > 0, 'Cannot find options.gitToken');

		test.done();
	}
};