'use strict';

var Errors = require('./errors');
var regexFuncName = /(?!\W*function\s+)[\w\$]+(?=\()/;
var regexStack = /stack/i;
module.exports = RollCall;

/**
 * Synchronous promise that provides a means to add a function to a waiting
 * promise queue along with an optional rollback function that will be called in
 * a queued or stack order whenever an {Error} is either thrown (stops further
 * promise functions from firing) or when all promiesed functions have been
 * called, but {Error}s have been logged
 * 
 * @constructor
 * @param grunt
 *            the grunt instance
 * @param options
 *            the task options
 */
function RollCall(grunt, options) {
	var wrk = null, wrkq = [], wrkd = [], wrkrb = [], prom = this, wi = -1, endc = null;
	var pausd = false, rbpausd = false, rbi = -1, rbcnt = 0, tm = null, es = new Errors(
			grunt, options);
	this.then = function(fx, rb) {
		wrk = new Work(fx, rb, Array.prototype.slice.call(arguments, 2));
		wrkq.push(wrk);
		return prom;
	};
	this.addRollbacks = function() {
		if (arguments.length === 0) {
			return;
		}
		// make sure the order of the passed rollback functions is
		// maintained regardless of strategy
		var args = isStack() ? Array.prototype.reverse.call(arguments)
				: arguments;
		for (var i = 0; i < args.length; i++) {
			prom.addRollback(args[i]);
		}
	};
	this.addRollback = function(rb) {
		if (typeof rb === 'function') {
			addRollbackObj(new Rollback(rb));
		}
	};
	this.work = function() {
		return wrk;
	};
	this.start = function(end) {
		endc = end || endc;
		var stop = null;
		pausd = false;
		if (!prom.hasPromises()) {
			return rollbacks();
		}
		for (wi++; wi < wrkq.length; wi++) {
			wrk = wrkq[wi];
			try {
				wrk.run();
				if (pausd) {
					return;
				}
			} catch (e) {
				stop = e;
				prom.error(e);
			} finally {
				if (stop || (!pausd && !prom.hasPromises())) {
					return rollbacks();
				}
			}
		}
	};
	this.hasPromises = function(i) {
		return (i || wi) < wrkq.length - 1;
	};
	this.pause = function(fx, rb) {
		pausd = true;
		var rtn = tko(rollbacks);
		runNow(fx, rb, Array.prototype.slice.call(arguments, 2));
		return rtn;
	};
	this.resume = function() {
		tko();
		if (!pausd) {
			return 0;
		}
		return prom.start();
	};
	this.worked = function() {
		return wrkd.slice(0);
	};
	this.error = function() {
		es.log.apply(es, arguments);
		return prom;
	};
	this.errorCount = function() {
		return es.count();
	};
	this.pauseRollback = function(fx, rb) {
		rbpausd = true;
		var rtn = tko(prom.resumeRollback);
		runNow(fx, rb, Array.prototype.slice.call(arguments, 2), true);
		return rtn;
	};
	this.resumeRollback = function() {
		tko();
		if (!rbpausd) {
			return 0;
		}
		return rollbacks();
	};
	this.hasRollbacks = function() {
		return rbi < wrkrb.length - 1;
	};
	function rollbacks() {
		rbpausd = false;
		if (prom.errorCount() > 0) {
			grunt.log.writeln('Processing ' + (wrkrb.length - rbcnt)
					+ ' rollback action(s)');
			for (rbi++; rbi < wrkrb.length; rbi++) {
				grunt.verbose.writeln('Calling rollback ' + wrkrb[rbi].name);
				try {
					wrkrb[rbi].run();
					rbcnt++;
					if (rbpausd) {
						grunt.verbose.writeln('Pausing after rollback '
								+ wrkrb[rbi].name);
						return rbcnt;
					}
				} catch (e) {
					prom.error(e);
				}
			}
		}
		return endc ? endc.call(prom, rbcnt) : rbcnt;
	}
	function runNow(fx, rb, args, isRb) {
		if (typeof fx === 'function') {
			var stop = null;
			try {
				if (isRb) {
					// immediately ran rollback needs to be tracked
					var rbo = addRollbackObj(new Rollback(fx));
					rbi++;
					rbcnt++;
					rbo.run();
				} else {
					var wrk = new Work(fx, rb, args, isRb);
					wrk.run();
				}
			} catch (e) {
				stop = e;
				prom.error(e);
			} finally {
				if (stop) {
					// rollback for the rollback
					if (isRb) {
						runNow(rb, null, null, true);
					} else {
						rollbacks();
					}
				}
			}
		}
	}
	function Work(fx, rb, args) {
		this.func = fx;
		this.rb = rb ? new Rollback(rb, args) : null;
		this.args = args;
		this.rtn = undefined;
		this.run = function() {
			this.rtn = this.func.apply(prom, this.args);
			wrkd.push(this);
			prom.addRollback(this.rb);
			return this.rtn;
		};
	}
	function Rollback(rb) {
		this.name = funcName(rb);
		this.run = function() {
			return typeof rb === 'function' ? rb.call(prom) : false;
		};
	}
	function addRollbackObj(rbo) {
		if (isStack()) {
			wrkrb.unshift(rbo);
		} else {
			wrkrb.push(rbo);
		}
		return rbo;
	}
	function funcName(fx) {
		var n = fx ? regexFuncName.exec(fx.toString()) : null;
		return n && n[0] ? n[0] : '';
	}
	function tko(cb) {
		if (tm) {
			clearTimeout(tm);
		}
		if (typeof cb === 'function') {
			var to = cb === rollbacks ? options.rollbackAsyncTimeout
					: options.asyncTimeout;
			var rbm = cb === rollbacks ? ' rolling back changes'
					: ' for rollback';
			tm = setTimeout(function() {
				prom.error('Timeout of ' + to + 'ms reached' + rbm);
				cb();
			}, to);
		}
		return prom;
	}
	function isStack() {
		return typeof options.rollbackStrategy === 'string'
				&& regexStack.test(options.rollbackStrategy);
	}
}