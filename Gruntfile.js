'use strict';

var regexDistUrl = /(\shref\s*=\s*["|\']?)(\s*https?:\/\/github\.com.*?(?:tar|zip)ball\/master.*?)(["|\']?)/gmi;
var regexSuppressWrite = /(key|GH_TOKEN)/mi;
var distPath = 'dist';
var marked = require('marked');

module.exports = function(grunt) {

	// Force use of Unix newlines
	grunt.util.linefeed = '\n';
	RegExp.quote = function(string) {
		return string.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&');
	};

	// initialize grunt
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
						src : [
								'{tasks,lib,test,css,img}/**/*.{js,md,css,svg,png}',
								'LICENSE', 'README.md', '*.json' ],
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
						distBranchUpdateFiles : [ 'README.md' ],
						distBranchUpdateFunction : function(contents, path,
								commit) {
							var zx = /zip/i;
							var tx = /tar/i;
							var zip = asset(commit.releaseAssets, zx);
							var tar = asset(commit.releaseAssets, tx);
							if (zip || tar) {
								// replace master zip/tarball with released
								// asset download URL
								contents = contents.replace(regexDistUrl,
										function(m, prefix, url, suffix) {
											var au = prefix + assetUrl(url)
													+ suffix;
											grunt.log.writeln('Replacing "' + m
													+ '" with "' + au + '"');
											return au;
										});
							}
							function assetUrl(url) {
								return zx.test(url) && zip ? zip.downloadUrl
										: tx.test(url) && tar ? tar.downloadUrl
												: '';
							}
							function asset(a, rx) {
								for (var i = 0; i < a.length; i++) {
									if (a[i]
											&& rx.test(a[i].asset.content_type)) {
										return a[i];
									}
								}
								return null;
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
	grunt.loadTasks('test/unit');
	// Custom tasks
	function writeHtml() {
		grunt.log.writeln('Creating distribution pages');
		var rmmd = grunt.file.read(__dirname + '/README.md', {
			encoding : grunt.file.defaultEncoding
		});
		var rmhtml = '<!DOCTYPE html><html><head>'
				+ '<meta http-equiv="content-type" content="text/html;charset=utf-8" />'
				+ '<title>releasebot</title>'
				+ '<link href="css/index.css" rel="stylesheet" media="screen" />'
				+ '</head><body>' + marked(rmmd) + '</body></html>';
		grunt.file.write(distPath + '/index.html', rmhtml);
		grunt.log.writeln('Generated distribution pages');
	}
	grunt.registerTask('pages', 'Create distribution pages', writeHtml);

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
			//grunt.log.writeln('Queuing "' + task + '" task');
			return this.tasks.push(task);
		};
	}

	// Build tasks
	var buildTasks = new Tasks();
	buildTasks.add('clean');
	buildTasks.add('copy:dist');
	buildTasks.add('pages');
	buildTasks.add('jshint');
	
	// Test tasks
	var testTasks = buildTasks.tasks.slice(0);
	testTasks.push('smokey');
	testTasks.push('nodeunit');
	testTasks.push('releasebot');
	grunt.registerTask('test', testTasks);

	// Default tasks
	grunt.registerTask('default', [ 'test' ]);
	
	// grunt smoketest -v --stack --TRAVIS_COMMIT_MESSAGE "Release v*.*.+"
	var smokeTasks = buildTasks.tasks.slice(0);
	smokeTasks.unshift('smokey');
	grunt.registerTask('smoketest', smokeTasks);
};