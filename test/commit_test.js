var semver = require('semver');
var coopt = require('../lib/coopt');
var rbot = require('../releasebot');

/**
 * Global configuration tests
 */
exports.commit = {
	config : function(test) {
		var c = getCommit();

		test.ok(c, 'Cannot find commit!');

		test.ok(c.versionRegExp, 'Cannot find commit.versionRegExp');
		test.ok(c.hash, 'Cannot find commit.hash');
		test.ok(c.buildDir, 'Cannot find commit.buildDir');
		test.ok(c.branch, 'Cannot find commit.branch');
		test.ok(c.slug, 'Cannot find commit.slug');
		test.ok(c.username, 'Cannot find commit.username');
		test.ok(c.reponame, 'Cannot find commit.reponame');
		test.ok(c.message, 'Cannot find commit.message');
		test.ok(Array.isArray(c.versionBumpedIndices), 'Cannot find commit.versionBumpedIndices');
		test.ok(Array.isArray(c.versionPrevIndices), 'Cannot find commit.versionPrevIndices');
		test.ok(c.prev, 'Cannot find commit.prev');
		test.ok(c.next, 'Cannot find commit.next');

		var vcv = semver.valid(c.version);
		test.ok(vcv, 'Invalid commit.version ' + c.version);

		var vpv = c.prev && semver.valid(c.prev.version);
		test.ok(vpv, 'Invalid commit.prev.version ' + (c.prev ? c.prev.version : 0));
		test.ok(vpv && semver.lte(c.prev.version, c.version), 'Previous version should satisfy '
				+ (c.prev ? c.prev.version : 0) + ' <= ' + (c.version || 0));

		var vnv = c.next && semver.valid(c.next.version);
		test.ok(vnv, 'Invalid commit.next.version ' + (c.next ? c.next.version : 0));
		test.ok(vnv && semver.gte(c.next.version, c.version), 'Next version should satisfy '
				+ (c.next ? c.next.version : 0) + ' >= ' + (c.version || 0));

		// match version test
		var mv = vcv ? rbot.config('matchVersion') : '';
		if (mv) {
			test.ok(semver.eq(c.version, mv), 'Version should satisfy ' + c.version + ' ~= ' + mv);
		}

		// meta data test
		test.ok(typeof c.versionMetadata !== 'undefined' && c.versionMetadata != null,
				'Cannot find commit.versionMetadata');
		if (vpv) {
			test.ok(c.versionMetadata === c.prev.versionMetadata, 'Version metadata should satisfy '
					+ c.versionMetadata + ' === ' + c.prev.versionMetadata);
		}

		test.done();
	}
};

function getCommit() {
	var c = coopt.getCommit(coopt.testNamespace);
	if (!c) {
		c = coopt.getCommit();
	}
	return c;
}