'use strict';

var util = require('util');
var committer = require('./committer');
var github = require('./github');
// rb uses relaxed version capture, but validates using semver
// https://github.com/mojombo/semver/issues/110#issuecomment-19433284
var regexVersion = /(v)((\d+|\++|\*)(\.)(\d+|\++|\*)(\.)(\d+|\++|\*)(-?)((?:[0-9A-Za-z-\.\+\*]*)*))/mi;
var regexReleasePrefix = /(releas(?:e|ed|ing))(\s*)/;
var regexBumpPrefix = /(bump(?:ed|ing)?)(\s*)/;
var regexRelease = new RegExp(regexReleasePrefix.source + regexVersion.source,
		'mi');
var regexSemverInc = /(v)\+(major|premajor|minor|preminor|patch|prepatch|prerelease)/i;
var regexEscape = /[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g;
var chgLog = 'CHANGELOG';

// default global options
var globalOpts = {
	pluginName : 'releasebot',
	regexVersion : regexVersion,
	regexRelease : regexRelease,
	regexReleaseSemverInc : new RegExp(regexReleasePrefix.source
			+ regexSemverInc.source, 'mi'),
	regexBump : new RegExp(regexBumpPrefix.source + regexVersion.source, 'mi'),
	regexBumpSemverInc : new RegExp(regexBumpPrefix.source
			+ regexSemverInc.source, 'mi'),
	pluginDesc : 'Git commit message triggered grunt task that tags a release (GitHub Release API '
			+ 'supported), generates/uploads release distribution asset archive(s), publishes a '
			+ 'distribution asset\'s content to a specified branch and publishes to npm when a '
			+ 'commit message matches the regular expression pattern: '
			+ regexRelease
			+ ' (for Travis CI set git: depth: in .travis.yml to a higher value than the default value '
			+ ' of 1 in order to properly capture change log)',
	regexSkipChgLog : /.*\[skip\s*CHANGELOG\].*\r?\n?/gi,
	regexLines : /(\r?\n)/g,
	regexDupLines : /^(.*)(\r?\n\1)+$/gm,
	regexKey : /(https?:\/\/|:)+(?=[^:]*$)[a-z0-9]+(@)/gmi,
};

// current commit tasks
var commitTasks = [];
// current test values
var testVals;

var coopt = exports;
coopt._getCommitTask = getCommitTask;
coopt._cloneAndSetCommitTask = cloneAndSetCommitTask;
coopt._testNamespace = 'test';
coopt._setTestValue = setTestValue;
coopt._getTestValue = getTestValue;
coopt.pluginName = globalOpts.pluginName;
coopt.pluginDesc = globalOpts.pluginDesc;
coopt.regexLines = globalOpts.regexLines;
coopt.regexKey = globalOpts.regexKey;
coopt.regexDupLines = globalOpts.regexDupLines;
coopt.getLineReplRegExp = getLineReplRegExp;
coopt.escapeRegExp = escapeRegExp;
coopt.getCommit = getCommit;
coopt.getEnv = getEnv;

/**
 * Generates commit options
 * 
 * @param grunt
 *            the grunt instance
 * @param commitMsg
 *            the commit message (optional)
 * @returns {___anonymous1480_2103}
 */
function genCommitOptions(grunt, commitMsg) {
	return {
		pluginName : globalOpts.pluginName,
		pluginDesc : globalOpts.pluginDesc,
		pkgPath : grunt.config('pkgFile') || 'package.json',
		gitCliSubstitute : '',
		buildDir : process.env.TRAVIS_BUILD_DIR || process.cwd(),
		branch : process.env.TRAVIS_BRANCH,
		commitHash : process.env.TRAVIS_COMMIT,
		commitMessage : commitMsg || process.env.TRAVIS_COMMIT_MESSAGE,
		repoSlug : process.env.TRAVIS_REPO_SLUG,
		releaseVersionDefaultLabel : 'release',
		releaseVersionDefaultType : 'v',
		releaseVersionRegExp : globalOpts.regexRelease,
		releaseVersionSemverIncRegExp : globalOpts.regexReleaseSemverInc,
		bumpVersionDefaultLabel : 'bump',
		bumpVersionDefaultType : 'v',
		bumpVersionRegExp : globalOpts.regexBump,
		bumpVersionSemverIncRegExp : globalOpts.regexBumpSemverInc,
		prevVersionMsgIgnoreRegExp : /No names found/i,
		gitToken : process.env.GH_TOKEN,
		npmToken : process.env.NPM_TOKEN
	};
}

/**
 * Gets or creates a commit task object that contains a commit object from a
 * predefined set of cooperative options along with the defaultTaskOptions for
 * that Commit (internal use)
 * 
 * @param grunt
 *            the grunt instance
 * @param cm
 *            alternative commit message from the extracted one (can be true to
 *            force initialization of a new Commit)
 * @param ns
 *            an optional name space to give the commit task
 * @param pv
 *            optional previous version (overrides previous version capture, but
 *            will not cause recreation of existing commit task)
 * @returns commit task
 */
function getCommitTask(grunt, cm, ns, pv) {
	var hcm = typeof cm === 'string';
	var ct = commitTasks[ns];
	if (!ct || hcm || cm === true) {
		var copts = genCommitOptions(grunt, hcm ? cm : null);
		var commit = committer.init(grunt, globalOpts.pluginName,
				globalOpts.regexLines, copts, ns ? null : undefined, ns, pv);
		var taskOpts = {
			name : '<%= commit.versionTag %>',
			pkgCurrVerBumpMsg : 'Updating <%= env.pkgPath %> version to match release version <%= commit.version %> <%= commit.skipTaskGen(options.releaseSkipTasks) %>',
			pkgNextVerBumpMsg : 'Bumping <%= env.pkgPath %> version to <%= commit.next.version %> <%= commit.skipTaskGen(options.releaseSkipTasks) %>',
			distBranchPubMsg : 'Publishing <%= commit.version %> <%= commit.skipTaskGen(options.releaseSkipTasks) %>',
			pkgJsonReplacer : null,
			pkgJsonSpace : 2,
			gitHostname : github.hostname,
			repoName : 'origin',
			repoUser : globalOpts.pluginName,
			repoEmail : globalOpts.pluginName
					+ '@'
					+ (process.env.TRAVIS_BUILD_NUMBER ? 'travis-ci.org'
							: 'example.org'),
			chgLog : 'HISTORY.md',
			authors : 'AUTHORS.md',
			chgLogLineFormat : '  * %s',
			chgLogRequired : true,
			chgLogSkipRegExps : [],
			authorsRequired : false,
			authorsSkipLineRegExp : null,
			distBranch : 'gh-pages',
			distDir : 'dist',
			distBranchCreateRegExp : /Couldn't find remote ref/i,
			distExcludeDirRegExp : /.?node_modules.?/gmi,
			distExcludeFileRegExp : /.?\.zip|tar.?/gmi,
			distAssetCompressRatio : 9,
			distAssetDir : '..',
			distAssetUpdateFunction : null,
			distAssetUpdateFiles : [],
			distBranchUpdateFunction : null,
			distBranchUpdateFiles : [],
			rollbackStrategy : 'queue',
			rollbackAsyncTimeout : 60000,
			asyncTimeout : 60000,
			releaseSkipTasks : [ 'ci' ],
			npmTag : '',
			npmRegistryURL : 'https://registry.npmjs.org'
		};
		commitTasks[ns] = {
			commit : commit,
			commitOpts : copts,
			defaultTaskOptions : taskOpts,
			namespace : ns
		};
	}
	return commitTasks[ns];
}

/**
 * Clones the current or generated commit and sets the cloned value in the Grunt
 * configuration (internal use)
 * 
 * @param commitTask
 *            the commit task that contains the commit to set
 * @param msg
 *            alternative verbose message (null prevents log output)
 */
function cloneAndSetCommitTask(commitTask, msg) {
	committer.cloneAndSetCommit(commitTask.commit, msg, commitTask.namespace);
}

/**
 * Gets the global commit set in the Grunt configuration
 * 
 * @param ns
 *            the optional namespace to use
 * @returns the commit
 */
function getCommit(ns) {
	return committer.getCommit(ns);
}

/**
 * Gets the environment in which the commit tasks are generated
 * 
 * @returns the commit task environment
 */
function getEnv() {
	return committer.getEnv();
}

/**
 * Sets a global test value
 * 
 * @param key
 *            the key
 * @param val
 *            the value
 */
function setTestValue(key, val) {
	if (!testVals) {
		testVals = [];
	}
	testVals[key] = val;
}

/**
 * Gets a global test value
 * 
 * @param key
 *            the key
 * @returns the value
 */
function getTestValue(key) {
	return testVals ? testVals[key] : null;
}

/**
 * Creates a regular expression for replacing line items
 * 
 * @param rxa
 *            the optional {Array} of {RegExp} or strings that will be included
 *            in the final expression (concatenated via OR in final expression)
 * @param tasks
 *            an optional {Array} of task names to replace using the generated
 *            sequence syntax (concatenated via OR in final expression)
 * @returns {RegExp} the generated regular expression
 */
function getLineReplRegExp(rxa, tasks) {
	var r = '', sf = null;
	function rxItem(o, i, a) {
		var s = util.isRegExp(o) ? o.source : o;
		if (s) {
			r += (sf ? sf(true, s) : '(?:' + s + ')')
					+ (i < (a.length - 1) ? '|' : '');
		}
	}
	if (Array.isArray(rxa) && rxa.length) {
		rxa.forEach(rxItem);
		// join tasks with or clause
		r += '|';
	}
	var tsks = Array.isArray(tasks) ? tasks : [];
	if (tsks.indexOf(chgLog) < 0) {
		tsks.push(chgLog);
	}
	console.log(tsks);
	sf = committer.skipTaskGen;
	tsks.forEach(rxItem);
	return new RegExp('^.*(' + r + ').*$\n?\r?', 'gmi');
}

/**
 * Escapes a string for use within a regular expression
 * 
 * @param str
 *            the string to escape
 * @returns the escaped string
 */
function escapeRegExp(str) {
	return str.replace(regexEscape, '\\$&');
}