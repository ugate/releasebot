'use strict';

var util = require('util');
var rbot = require('../releasebot');

module.exports = Errors;

/**
 * Work/Error tracking
 * 
 * @constructor
 * @param options
 *            the task options
 */
function Errors(options) {
	var errors = [];

	/**
	 * Logs one or more errors (can be {Error}, {Object} or {String})
	 */
	this.log = function() {
		for (var i = 0; i < arguments.length; i++) {
			if (util.isArray(arguments[i])) {
				this.log(arguments[i]);
			} else {
				logError(arguments[i]);
			}
		}
	};

	/**
	 * @returns the number of errors logged
	 */
	this.count = function() {
		return errors.length;
	};

	/**
	 * Logs an error
	 * 
	 * @param e
	 *            the {Error} object or string
	 */
	function logError(e) {
		e = e instanceof Error ? e : e ? new Error(e) : null;
		if (e) {
			if (options && util.isRegExp(options.hideTokenRegExp)) {
				e.message = e.message.replace(options.hideTokenRegExp, function(match, prefix, token, suffix) {
					return prefix + '[SECURE]' + suffix;
				});
			}
			errors.unshift(e);
			rbot.log.error(e.stack || e.message);
		}
	}
}