'use strict';

var release = require('./tasks/release');
var pack = require('./lib/pack');

var rbot = exports = module.exports = registerReleaseTask;
rbot.taskRunner = null;
rbot.config = config;
rbot.task = task;
rbot.processTemplate = processTemplate;
rbot.runtimeRequire = pack.runtimeRequire;
rbot.log = null;
rbot.env = null;

var configData = {};
init();

/**
 * Initializes the environment (if needed)
 */
function init() {
	var ugr = rbot.env ? rbot.env.usingGrunt : require.main.filename.indexOf('grunt') >= 0;
	if (!rbot.env) {
		rbot.env = {
			usingGrunt : ugr
		}
	}
	var notr = !rbot.env.taskRunner;
	if (notr) {
		// grunt should pass instance as 1st argument
		rbot.env.taskRunner = ugr ? (arguments[0] ? arguments[0] : require('grunt')) : require('gulp');
	}
	var tr = rbot.env.taskRunner;
	if (notr || !rbot.log) {
		var ugrl = ugr && tr && tr.log;
		rbot.log = {
			verboseEnabled : !ugr || !tr || tr.option('verbose'),
			verbose : ugr && tr && tr.verbose ? tr.verbose.writeln : console.log,
			debug : ugrl ? tr.log.debug : console.log,
			info : console.info || console.log,
			warn : console.warn,
			error : ugrl ? tr.log.error : console.error,
			fail : function fail(e) {
				var tr = rbot.env.taskRunner;
				if (rbot.env.usingGrunt && tr && tr.fail) {
					return tr.fail.fatal(e);
				}
				throw (e instanceof Error ? e : new Error(e));
			},
			dir : ugrl ? tr.log.writeflags : console.dir
		};
	}
	if (notr || !rbot.file) {
		var ugrf = ugr && tr && tr.file;
		rbot.file = {
			read : ugrf ? tr.file.read : null,
			write : ugrf ? tr.file.write : null,
			defaultEncoding : ugrf ? tr.file.defaultEncoding : null,
			readJSON : ugrf ? tr.file.readJSON : null,
			writeJSON : ugrf ? tr.file.writeJSON : null
		};
	}
	if (notr || !rbot.option) {
		rbot.option = ugr && tr && tr.option ? tr.option : null;
	}
}

/**
 * Registers the release task
 */
function registerReleaseTask() {
	// make sure the release task has been initialized
	init.apply(this, arguments);
	// register release task
	release.apply(this, arguments);
}

/**
 * Registers a task runner neutral API for a task. If using Grunt "registerTask"
 * is executed. If using Gulp "task" is executed. In either case the arguments
 * are passed in the expected order regardless of how they are passed into this
 * function.
 * 
 * @returns the return value from the task runner API
 */
function task() {
	// make sure the release task has been initialized
	init.apply(this, arguments);
	var name, desc, deps, cb;
	for (var i = 0; i < arguments.length; i++) {
		if (typeof arguments[i] === 'string') {
			if (name) {
				desc = arguments[i];
			} else {
				name = arguments[i];
			}
		} else if (typeof arguments[i] === 'function') {
			cb = taskCallback(arguments[i]);
		} else if (Array.isArray(arguments[i])) {
			deps = arguments[i];
		}
	}
	if (rbot.env.usingGrunt) {
		if (name && desc) {
			return rbot.env.taskRunner.registerTask(name, desc, cb);
		} else if (name && deps) {
			return rbot.env.taskRunner.registerTask(name, deps);
		}
		throw new Error('Invalid grunt.registerTask() for: name = "' + name + '", desc = "' + desc + '", taskList = "'
				+ deps + '", function = "' + cb + '"');
	} else {
		if (name && deps && cb) {
			return rbot.env.taskRunner.task(name, deps, cb);
		} else if (name && cb) {
			return rbot.env.taskRunner.task(name, cb);
		}
		throw new Error('Invalid gulp.task() for: name = "' + name + '", deps = "' + deps + '", function = "' + cb
				+ '"');
	}
}

/**
 * Creates a task callback function that will wrap the passed callback that the
 * task runner requires to ensure consistent option behavior between different
 * task runners. When the specified function contains arguments the wrapper will
 * assume that the associated task will be executed in an asynchronous fashion.
 * Relies on the number of arguments defined in the passed function to determine
 * synchronicity.
 * 
 * @param fn
 *            the function that will be wrapped
 * @returns a wrapped callback function
 */
function taskCallback(fn) {
	return fn.length ? taskAsyncCb : taskSyncCb;
	function taskAsyncCb(cb) {
		return taskCb(this || {}, arguments, fn, cb, true);
	}
	function taskSyncCb() {
		return taskCb(this || {}, arguments, fn, null, false);
	}
	function taskCb(cxt, args, fn, done, isAsync) {
		cxt.done = isAsync && typeof done === 'function' ? done : isAsync && typeof cxt.async === 'function' ? cxt
				.async() : taskSyncDone;
		if (!rbot.env.usingGrunt) {
			// set options using either a configuration value or the passed
			// default value
			cxt.options = function setOptions(defOpts) {
				Object.keys(defOpts).forEach(function it(k) {
					this.options[k] = rbot.config(k) || defOpts[k];
				}.bind(this));
				return this.options;
			}.bind(cxt);
		}
		var fna = args;
		if (cxt.done !== done && cxt.done !== taskSyncDone) {
			// ensure that the done function still gets passed as the 1st
			// argument even when the task runner doesn't pass it
			fna = args ? Array.prototype.slice.call(args, 0) : [];
			fna.unshift(cxt.done);
		}
		return fn.apply(cxt, fna);
	}
	function taskSyncDone(success) {
		rbot.log.verbose('Synchronous task ' + (success ? 'completed' : 'failed'));
	}
}

/**
 * Gets/Sets a configuration value designated by a key (key: 1st argument,
 * value: 2nd argument - optional)
 * 
 * @returns the processed value
 */
function config() {
	if (rbot.env.usingGrunt) {
		return rbot.env.taskRunner.config.apply(null, arguments);
	}
	return arguments.length === 2 ? configData[arguments[0]] = processTemplate(arguments[1], {
		data : rbot.env
	}) : configData[arguments[0]];
}

/**
 * Processes a value using the passed data
 * 
 * @param val
 *            the value
 * @param data
 *            the object that contains the template data to use
 * @returns the processed value
 */
function processTemplate(val, data) {
	if (rbot.env.usingGrunt) {
		return rbot.env.taskRunner.template.process(val, data);
	}
	// TODO : add gulp template processing
	if (!val) {
		return val;
	}
	return val;
}