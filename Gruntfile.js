'use strict';

var regexDistUrl = /(\shref\s*=\s*["|\']?)(\s*https?:\/\/github\.com.*?(?:tar|zip)ball\/master.*?)(["|\']?)/gmi;
var regexSuppressWrite = /(key|GH_TOKEN)/mi;
var distPath = 'dist';

module.exports = function(grunt) {

	// Force use of Unix newlines
	grunt.util.linefeed = '\n';
	RegExp.quote = function(string) {
		return string.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&');
	};

	var pkg = grunt.file.readJSON('package.json');
	grunt
			.initConfig({
				pkg : pkg,
				banner : '/*!\n'
						+ ' * <%= pkg.name %>.js v<%= pkg.version %> (<%= pkg.homepage %>)\n'
						+ ' * Copyright 2014-<%= grunt.template.today("yyyy") %> <%= pkg.author %>\n'
						+ ' * Licensed under <%= _.pluck(pkg.licenses, "type") %> (<%= _.pluck(pkg.licenses, "url") %>)\n'
						+ ' */\n',
				sourceFiles : 'js/*.js',

				// Task configuration

				clean : {
					dist : [ distPath ]
				},

				copy : {
					dist : {
						expand : true,
						src : [ '{tasks,lib,test}/**/*.{js,md}', 'LICENSE',
								'README.md', '*.json' ],
						dest : distPath
					}
				},

				jshint : {
					gruntfile_tasks : [ 'Gruntfile.js', 'tasks/*.js' ],
					libs_n_tests : [ 'lib/**/*.js', '<%= nodeunit.tests %>' ],
					options : {
						curly : true,
						eqeqeq : true,
						immed : true,
						latedef : 'nofunc',
						newcap : true,
						noarg : true,
						sub : true,
						undef : true,
						unused : true,
						boss : true,
						eqnull : true,
						node : true,
						laxbreak : true
					}
				},

				nodeunit : {
					tests : 'test/**/*.js'
				},

				releasebot : {
					options : {
						distAssetUpdateFiles : [ 'README.md' ],
						distAssetUpdateFunction : function(contents, path,
								commit) {
							if (commit.releaseAssetUrl) {
								// replace master zip/tarball with released
								// asset download URL
								contents = contents.replace(regexDistUrl,
										function(m, prefix, url, suffix) {
											var au = prefix
													+ commit.releaseAssetUrl
													+ suffix;
											grunt.log.writeln('Replacing "' + m
													+ '" with "' + au + '"');
											return au;
										});
							}
							return contents;
						}
					}
				}
			});

	// Load tasks from package
	for ( var key in grunt.file.readJSON('package.json').devDependencies) {
		if (key !== 'grunt' && key.indexOf('grunt') === 0) {
			grunt.loadNpmTasks(key);
		}
	}
	// load project tasks
	grunt.loadTasks('tasks');

	// suppress certain options in verbose mode
	var writeflags = grunt.log.writeflags;
	grunt.log.writeflags = function(obj, prefix) {
		var m = null;
		if (typeof obj === 'object'
				&& obj
				&& (m = Object.getOwnPropertyNames(obj).join(',').match(
						regexSuppressWrite)) && m.length > 0) {
			var obj2 = JSON.parse(JSON.stringify(obj));
			obj2[m[1]] = '[SECURE]';
			return writeflags(obj2, prefix);
		}
		return writeflags(obj, prefix);
	};

	/**
	 * Task array that takes into account possible skip options
	 * 
	 * @constructor
	 */
	function Tasks() {
		this.tasks = [];
		this.add = function(task) {
			var commit = grunt.config.get('releasebot.commit');
			if (commit.skipTaskCheck(task)) {
				grunt.log.writeln('Skipping "' + task + '" task');
				return false;
			}
			grunt.log.writeln('Queuing "' + task + '" task');
			return this.tasks.push(task);
		};
	}

	// Build tasks
	var buildTasks = new Tasks();
	buildTasks.add('clean');
	buildTasks.add('copy:dist');
	buildTasks.add('jshint');
	buildTasks.add('nodeunit');
	buildTasks.add('releasebot');
	grunt.registerTask('test', buildTasks.tasks);

	// Default tasks
	grunt.registerTask('default', [ 'test' ]);
};