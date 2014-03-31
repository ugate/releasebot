var grunt = require('grunt');

/**
 * Global configuration tests
 */
exports.globals = {
	options : function(test) {
		var o = grunt.config.get('releasebot.env');
		test.ok(o, 'Cannot find grunt.config.get("releasebot.env")');

		test.ok(o.pkgPath, 'Cannot find options.pckPath');
		test.ok(o.buildDir, 'Cannot find options.buildDir');
		test.ok(o.gitToken, 'Cannot find options.gitToken');

		test.done();
	},
	commit : function(test) {
		var c = grunt.config.get('releasebot.commit');
		test.ok(c, 'Cannot find grunt.config.get("releasebot.commit")');

		test.ok(c.number, 'Cannot find commit.number');
		test.ok(c.buildDir, 'Cannot find commit.buildDir');
		test.ok(c.branch, 'Cannot find commit.branch');
		test.ok(c.slug, 'Cannot find commit.slug');
		test.ok(c.username, 'Cannot find commit.username');
		test.ok(c.reponame, 'Cannot find commit.reponame');
		test.ok(c.message, 'Cannot find commit.message');
		test.ok(Array.isArray(c.versionBumpedIndices),
				'Cannot find commit.versionBumpedIndices');
		test.ok(Array.isArray(c.versionLastIndices),
				'Cannot find commit.versionLastIndices');
		test.ok(c.lastCommit, 'Cannot find commit.lastCommit');

		test.done();
	}
};