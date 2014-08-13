'use strict';

var path = require('path');
var nodeunit = require('nodeunit');
//var reporter = require('nodeunit').reporters.minimal;
var coopt = require('../../lib/coopt');

/**
 * Smoke test that runs through a series of sample commit messages
 */
module.exports = function(grunt) {

	var okfailrx = /^Previous version should satisfy/i;

	// register unit task
	grunt.registerTask('smokey', 'Performs smoke tests', function smokeyCallback() {
		var done = this.async();
		var options = this.options({
			tests : path.join(__dirname, '/../smoketests.json')
		});

		var tests = require(options.tests);
		var rslt = {
			start : process.hrtime(),
			req : null,
			commitTask: null,
			total : tests.length,
			started : 0,
			ran : 0,
			failed : 0,
			assertFailed : 0,
			assertions : 0
		};
		console.log('=======> Running %s smoke tests', rslt.total);
		test();

		function test() {
			if (rslt.failed || !(rslt.req = tests.shift())) {
				var diff = process.hrtime(rslt.start);
				console.log('=======> Completed %s of %s smoke tests with %s failures (%s assertion failures) '
						+ 'took %s ms for the smoke to clear', 
						rslt.ran, rslt.total, rslt.failed, rslt.assertFailed, 
						(diff[0] * 1e9 + diff[1]) / 1000000);
				// reset test data
				coopt._cloneAndSetCommitTask({
					commit : null,
					namespace : coopt._testNamespace
				});
				done(rslt.failed === 0);
				return;
			}
			rslt.started++;
			//logit(true);
			
			// generate/set commit
			rslt.commitTask = coopt._getCommitTask(grunt, rslt.req.commitMessage, coopt._testNamespace, 
					rslt.req.currentVersion);
			if (rslt.req.matchVersion && rslt.commitTask && rslt.commitTask.commit) {
				rslt.commitTask.commit._matchVersion = rslt.req.matchVersion;
			}
			coopt._cloneAndSetCommitTask(rslt.commitTask, rslt.req.showCommitMsg ? rslt.req.showCommitMsg : null);

			// run test
			nodeunit.runModule('commit', require('../commit_test'), {}, testComplete);
			//reporter.run(['test/unit/globals_test.js'], {}, testComplete);
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
			console.log('=======> %s %s/%s smoke tests, current ver: %s and commit msg: %s%s', 
					s ? 'Starting' : rslt.failed ? 'Failed on' : 'Completed', s ? rslt.started : rslt.ran, 
							rslt.total, rslt.req.currentVersion, rslt.req.commitMessage, 
							!s && rslt.commitTask && rslt.commitTask.commit ? ' commit ver: ' + 
									rslt.commitTask.commit.versionTag : '');
		}
	});
};