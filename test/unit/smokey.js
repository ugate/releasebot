'use strict';

var path = require('path');
var nodeunit = require('nodeunit');
// var reporter = require('nodeunit').reporters.minimal;
var coopt = require('../../lib/coopt');
var rbot = require('../../releasebot');

// flag to indicate if the tests should log output pertaining to the generated
// commits
var verbose = false;
var ns = 'test';

/**
 * Smoke test that runs through a series of sample commit messages
 */
module.exports = function() {

	var okfailrx = /^Previous version should satisfy/i;

	// register unit task
	rbot.task('smokey', 'Performs smoke tests', function smokeyCallback(done) {
		var options = this.options({
			tests : path.join(__dirname, '/../smoketests.json')
		});

		var tests = require(options.tests) || [];
		var rslt = {
			start : process.hrtime(),
			req : null,
			commitTask : null,
			total : 0,
			started : 0,
			ran : 0,
			failed : 0,
			assertFailed : 0,
			assertions : 0
		};

		// run tests
		rslt.total = tests.length;
		console.log('=======> Running %s smoke tests', rslt.total);
		test();

		function test() {
			if (rslt.failed || !(rslt.req = tests.shift())) {
				var diff = process.hrtime(rslt.start);
				console.log('=======> Completed %s of %s smoke tests with %s failures (%s %sassertion failures) '
						+ 'took %s ms for the smoke to clear', rslt.ran, rslt.total, rslt.failed, rslt.assertFailed,
						(rslt.failed ? '' : 'expected '), (diff[0] * 1e9 + diff[1]) / 1000000);
				// reset test data
				coopt._cloneAndSetCommitTask({
					commit : null,
					namespace : ns
				});
				done(rslt.failed === 0);
				return;
			}
			rslt.started++;
			// logit(true);

			// generate/set commit
			rslt.commitTask = coopt._getCommitTask(rslt.req.commitMessage, ns, rslt.req.currentVersion, !verbose);
			if (rslt.req.matchVersion && rslt.commitTask && rslt.commitTask.commit) {
				rbot.config('matchVersion', rslt.req.matchVersion);
			}
			// coopt._cloneAndSetCommitTask(rslt.commitTask,
			// rslt.req.showCommitMsg ? rslt.req.showCommitMsg : null);

			// run test
			nodeunit.runModule('commit', require('../commit_test'), {}, testComplete);
			// reporter.run(['test/unit/globals_test.js'], {}, testComplete);
		}
		function testComplete(name, assertions) {
			rslt.ran++;
			rslt.assertions += assertions.length;
			rslt.assertFailed += assertions.failures();
			var failed = false;
			assertions.forEach(function assertCheck(a) {
				if (a.failed()) {
					failed = true;
					if (rslt.req.fails && okfailrx.test(a.message)) {
						console.log('Received expected error: ' + a.message);
						return;
					}
					rslt.failed++;
					console.error('=======> %s', a.message || a.method);
					console.error(a.error);
				}
			});
			if (!failed && rslt.req.fails) {
				rslt.failed++;
				console.error('=======> Expected failure %s, but none was received', okfailrx);
			}
			logit();
			test();
		}
		function logit(s) {
			console.log('=======> %s %s/%s smoke test, current ver: %s for "%s"%s%s', s ? 'Starting'
					: rslt.failed ? 'Failed on' : 'Completed', s ? rslt.started : rslt.ran, rslt.total,
					rslt.req.currentVersion, rslt.req.commitMessage,
					!s && rslt.commitTask && rslt.commitTask.commit ? ' ' + rslt.commitTask.commit.versionTag : '',
					rslt.req.matchVersion ? ' ✓' : '');
		}
	});
};