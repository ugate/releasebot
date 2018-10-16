> Deprecated. Use CI plugins instead

# <a href="http://ugate.github.io/releasebot"><img src="http://ugate.github.io/releasebot/img/logo.svg"/></a>
[![NPM version](http://img.shields.io/npm/v/releasebot.svg?style=flat)](https://npmjs.org/package/releasebot) [![NPM downloads](http://img.shields.io/npm/dm/releasebot.svg?style=flat)](https://www.npmjs.org/package/releasebot) [![Build Status](http://img.shields.io/travis/ugate/releasebot/master.svg?style=flat)](https://travis-ci.org/ugate/releasebot) [![Dependency Status](https://david-dm.org/ugate/releasebot.png)](https://david-dm.org/ugate/releasebot) [![devDependency Status](https://david-dm.org/ugate/releasebot/dev-status.png)](https://david-dm.org/ugate/releasebot#info=devDependencies)

**releasebot** is a task for triggering an automated release process when a commit message matches a predefined regular expression. The commit message that triggers the automated release process can also be <a href="#default-global-plug-in-environment-options">specified rather than extracted from a commit message</a>. If any of the release actions fail, any prior actions that have successfully completed will be [rolled back to their previous state](//ugate.github.io/releasebot/img/workflow.png). Both [Grunt](http://gruntjs.com/) and [Gulp](http://gulpjs.com/) are supported!

#### [Click here](//github.com/ugate/releasebot/releases) for example GitHub releasebot generated releases!

<img src="http://ugate.github.io/releasebot/img/github.png"/>

#### [Click here](//github.com/ugate/releasebot/tree/gh-pages) for example GitHub releasebot generated `gh-pages`!

#### [Click here](//ugate.github.io/releasebot/img/workflow.png) to view a detailed workflow of what actions are performed by releasebot!

<img src="http://ugate.github.io/releasebot/img/workflow.png" height="200px"/>

## Usage Examples

Each commit message will be checked for the presence of a version to release. The default expression checks for `release v` followed by a <a href="http://semver.org/">semantic compliant version</a> or a `+` or `*` within the appropriate version *slot* indicating the version should be either *incremented* by the number of `+` for a given slot or that the value should be replaced by the *last/currently* released version (respectively).

The commit message below will result in a release of version `1.0.0` (surrounding text will be ignored):
```shell
This is Release v1.0.0 of my app
```

To release version `1.0.2` when the latest release is `1.0.0`:
```shell
release v*.*.2
```

To release version `1.0.1` when the latest release is `1.0.0`:
```shell
release v*.*.+
```

To release version `1.2.1` when the latest release is `1.0.0`:
```shell
release v*.++.+
```

To release version `2.0.0` when the latest release is `1.1.1`:
```shell
release v+.0.0
```

To release version `0.0.1-beta.1` when the latest release is `0.0.1-alpha.3`:
```shell
release v*.*.*-+.1
```

To release version `0.0.1-alpha.1` when no prior releases have been made:
```shell
release v*.*.+-alpha.+
```

To release version `2.0.0` when the latest release is `1.1.1` via the [grunt cli](http://gruntjs.com/using-the-cli):
```shell
grunt releasebot --releasebot.commitMessage="Release v+.0.0"
```

To release version `2.0.0` when the latest release is `1.1.1` via the [gulp cli](https://github.com/gulpjs/gulp/blob/master/docs/CLI.md):

```shell
gulp releasebot --releasebot.commitMessage="Release v+.0.0"
```

For you [node-semver purists](https://www.npmjs.org/doc/misc/semver.html#functions) you can use the syntax `release v+RELEASE_TYPE` where RELEASE_TYPE is one of the defined values passed into [inc(v, release)](https://www.npmjs.org/doc/misc/semver.html#functions).

To release version `2.0.0` when the latest release is `1.0.0`:
```shell
release v+major
```

Although `+` and `*` can be used within a pre-release, care should be taken to ensure the proper slots are referenced. For example, if a prior release of `0.0.1-5.10.3` exists a commit message of `release v*.*.*-beta.*.+` the resulting version will become `0.0.1-beta.5.11` because the first numeric version slot in the prior release is occupied by `5` while the second numeric version is occupied by `10`. Due to the relaxed nature of the <a href="http://semver.org/">semantic version specification</a>, version numbers can reside in unforeseen locations within a pre-release sequence. Also, `+` pre-release increments can not be adjacent to <a href="http://semver.org/">metadata</a> (i.e. trying to release `1.0.0-x.7.z.92+20500101084500` using a commit message of `release v1.0.0-x.7.z.9++20500101084500` will result in `1.0.0-x.7.z.9420500101084500`).

#### Bumping versions

In all of the prior [usage examples](#usage-examples) the version is incremented on the package once the release successfully completes (optional). First, the bump version expression is used against the commit message to determine what the next version will be. If it cannot find a bump version it will auto-increment the current release version by one and use that value as the next release version.

To release version `1.1.0` when the latest release is `1.0.0` (next version is auto-incremented to `1.1.1`)
```shell
release v*.+.0
```

To release version `1.1.1-beta.1` when the latest release is `1.1.0` (next version is auto-incremented to `1.1.1-beta.2`)
```shell
release v*.*.+-beta.1
```

To release version `1.1.1-beta.1` when the latest release is `1.1.0` and explicitly set the next version to `1.1.1-rc.1`
```shell
release v*.*.+-beta.1 bump v*.*.*-rc.*
```

As you can see the *release* version use of `*` and `+` is relative to the *last/currently* released version. In contrast, the *bump* version use of `*` and `+` is based upon the version that's being released.

## Getting Started

####[Grunt](http://gruntjs.com/)

If you haven't used [Grunt](http://gruntjs.com/) before, be sure to check out the [Getting Started](http://gruntjs.com/getting-started) guide, as it explains how to create a [Gruntfile](http://gruntjs.com/sample-gruntfile) as well as install and use Grunt plugins. Once you're familiar with that process, you may install this plugin with this command:

```shell
npm install releasebot --save-dev
```

Once the plugin has been installed, it may be enabled inside your Gruntfile with this line of JavaScript:

```js
grunt.loadNpmTasks('releasebot');
```

####[Gulp](http://gulpjs.com/)

If you haven't used [Gulp](http://gulpjs.com/) before, be sure to check out the [Getting Started](https://github.com/gulpjs/gulp/blob/master/docs/getting-started.md) guide, as it explains how to create a gulpfile as well as install and use Gulp plugins. Once you're familiar with that process, you may install this plugin with this command:

```shell
npm install releasebot --save-dev
```

Once the plugin has been installed, it may be enabled inside your gulpfile with this line of JavaScript:

```js
require('gulp').task('releasebot', require('releasebot'));
```

####[Git](http://git-scm.com/)

There isn't any special setup for Git. However, it's a good idea to follow GitHub's [recommendations regarding line endings](https://help.github.com/articles/dealing-with-line-endings) so you don't run into an issue where your new line characters are mysteriously missing from your commit message. This will help to avoid issues where a release trigger is followed by a new line character, but instead the content of the next line gets appended to the end of your release version!

####[Travis CI](http://travis-ci.com/)

By default, `process.env.GH_TOKEN` is used for authorization for Git pushes and the alike. It's recommended you encrypt the token following [travis encrypttion guidlines](http://docs.travis-ci.com/user/encryption-keys/).

When using releasebot's built-in *distribution branch* publishing make sure to exclude that branch (or restrict to master) from travis builds in your `.travis.yml` file:

```yaml
branches:
  only:
  - master
git:
  branch: master
```

By default, travis [clones](https://www.kernel.org/pub/software/scm/git/docs/git-clone.html) repositories with a `depth=1`. You will need to set this value high enough to accommodate the desired level of history in your `.travis.yml` file:

```yaml
git:
  depth: 2147483647
```

####[NPM](https://www.npmjs.org/)

If you're using travis-ci and do not require any of the built-in npm publish capabilities that releasebot has to offer, it's recommended that you use [the npm deploy option offered by travis-ci](http://docs.travis-ci.com/user/deployment/npm/).

Linking the global npm module or installing the local npm module (outlined below) is only necessary when using the releasebot npm publish options.

In order to enable releasebot's `npm publish` step, a token needs to be generated by executing `npm login` from the command line. You will be prompted for your credentials. Once authenticated, an `_auth` entry will be added to your user directory in a file named `~/.npmrc`. The value can be used to set the `process.env.NPM_TOKEN` which releasebot uses to authenticate the npm publishing process. If your using <a href="#travis-ci">Travis CI</a> it's recommended you encrypt the npm token following the [travis encrypttion guidlines](http://docs.travis-ci.com/user/encryption-keys/) (e.g. `travis encrypt NPM_TOKEN=secretvaluefrom_auth`).

If you are using travis-ci you will have to add the following to link the global npm that comes with node in your `.travis.yml` (non-ci environments you can just issue `npm link npm` at your package dir):

```yaml
before_script:
- npm link npm
```

**Tips:**

* If you encounter [an error similar to](https://github.com/travis-ci/travis-ci/issues/1588) `The authenticity of host 'github.com' can't be established` while using `.travis.yml` add the following:

```yaml
before_script:
- echo -e "Host *\n\tStrictHostKeyChecking no\n" >> ~/.ssh/config
```

####[Bower](http://bower.io)

Linking the global bower module or installing the local bower module (outlined below) is only necessary when using the releasebot bower lookup/register options.

If the `pkgPathBower` option points to a valid [bower JSON file](https://github.com/bower/bower.json-spec) (typically `bower.json`) and a valid `pkgPath` exists, they will be synchronized as releases are issued. Only property names defined in the `pkgPropSync` array will be synchronized between package JSON when the task is registered and a release has been triggered. Properties will be matched at the first-level only (e.g. `version` will match `{"version":"0.0.1"}`, but will not match `{"someProp":{"version":"0.0.1"}}`). The `name` defined in the bower package will be used to ["lookup"](http://bower.io/docs/api/#lookup) the package in the bower registry to see if it exists (at release time). When no match is found, an attempt will be made to ["register"](http://bower.io/docs/api/#register) the bower package using the defined `name`. Consecutive releases are automatically handled by bower using tagged releases issued to Git.

If you are using travis-ci you will have to add the following to install bower and link it to your module in your `.travis.yml` (non-ci environments you can just issue `npm install -g bower` and `npm link bower` at your package dir):

```yaml
before_script:
- npm install -g bower
- npm link bower
```

### Distribution
By default, a `HISTORY.md` file will be created that will contain a list of commit messages since the last release (the same info that is used as the release description). An `AUTHORS.md` will also be generated that will contain a list of authors since the last release, prefixed with the number of contributed commits. Both of these files along with the contents of the `distDir` (<a href="#default-task-specific-options">filterable</a>) will be published to the `distBranch` (when defined) and used as the contents of the compressed archive assets (zip and tar). An optional `[skip CHANGELOG]` can be appended to any commit message to indicate that the commit message should not be included in `HISTORY.md` and the release description. Alternatively, an array of custom regular expressions can be used in the `chgLogSkipRegExps` option.

### Skip Indicators
Skip indicators are used within commit messages to notify underlying systems that a particular operation should not be performed for a particular commit. An example of which is the [skip option for travis-ci](http://docs.travis-ci.com/user/how-to-skip-a-build/). By default, releasebot adds a flag to `releaseSkipTasks` in order to skip additional continuous integration builds when internal releasebot commits are performed (i.e. bumping package versions, etc.). The semantics follow commonly recognized patterns used by various tools (i.e. `[skip ci]`). When the releasebot task is registered it automatically captures all the skip operations/tasks that exist within the current commit message and exposes them via `skipTasks`. This can also be useful within Grunt in order to establish conditional task execution based upon the current commit message:

```js
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
grunt.registerTask('build', buildTasks.tasks);
```
The same thing can be accomplished using Gulp:

```js

```

## Options

There are two types of releasebot options. The first type of options are <a href="#default-global-plug-in-environment-options">globally defined</a> and are applied when the releasebot task is registered, but prior to any releasebot task executions. This allows for accessibility of extracted <a href="#commit">commit</a> details for other tasks that are ran before releasebot. It also provides a shared data pool and prevents duplicating the extraction process and prevents discrepancies between multiple relesebot task executions (e.g. in case releasebot needs to be re-ran due to a prior release failure). The second type is the <a href="#default-task-specific-options">typical task specific options</a>.

###Default global plug-in environment options:

Global environment options are set once the releasebot task is registered and are accessible via `releasebot.config('releasebot.env')` (synonymous with `grunt.config.get('releasebot.env')` when using Grunt).

The following **global plug-in environment options** can be set using one of the following techniques.

####Global environment option extraction (in order of presidence):

1. Via `releasebot.config('releasebot.env', options)` (synonymous with `grunt.config('releasebot.env', options)` when using Grunt)  before the releasebot task is registered
2. Passed in from the command line `grunt releasebot --releasebot.theoptionname=THE_OPTION_VALUE` or `gulp releasebot --releasebot.theoptionname=THE_OPTION_VALUE`
3. Automatically from the <a href="http://docs.travis-ci.com/user/ci-environment/#Environment-variables">Travis-CI environmental variables</a> (if applicable)
4. Default option value or extracted from Git (if applicable)

```js
{
  // The path to the project package file (blank/null prevents npm publish)
  pkgPath : 'package.json',
  // The path to the bower package file (blank/null prevents bower register)
  pkgPathBower : 'bower.json',
  // The properties that will be synchronized between package JSON during a release (properties must exist in all pkgPath* JSON) 
  pkgPropSync : [ 'name', 'version', 'repository' ],
  // CLI executable for Git operations
  gitCliSubstitute : 'git',
  // Directory where the build will take place
  buildDir : process.cwd(),
  // Git branch that will be released (default: global env option extraction or from current checkout)
  branch : '',
  // The commit message that will be checked for release trigger (default: global env option extraction or from last/current commit)
  commitNumber : '',
  // The commit message that will be checked for release trigger (default: global env option extraction or from last/current commit)
  commitMessage : '',
  // The repository slug the release is for (default: global env option extraction or from current checkout)
  repoSlug : '',
  // The default release label used against releaseVersionRegExp
  releaseVersionDefaultLabel : 'release',
  // The default release version prefix used against releaseVersionRegExp
  releaseVersionDefaultType : 'v',
  // The regular expression used to check the commit message for the presence of a release to trigger (match order must be maintained)
  releaseVersionRegExp : /(releas(?:e|ed|ing))(\s*)(v)((\d+|\++|\*)(\.)(\d+|\++|\*)(\.)(\d+|\++|\*)(-?)((?:[0-9A-Za-z-\.\+\*]*)*))/mi,
  // The regular expression used to check the commit message for the presence of a release to trigger using semver syntax (match order must be maintained)
  releaseVersionSemverIncRegExp : /(releas(?:e|ed|ing))(\s*)(v)\+(major|premajor|minor|preminor|patch|prepatch|prerelease)/mi,
  // The regular expression used to check the commit message for the presence of a bump version that will be used once the release completes (match order must be maintained)
  bumpVersionRegExp : /(bump(?:ed|ing)?)(\s*)(v)((\d+|\++|\*)(\.)(\d+|\++|\*)(\.)(\d+|\++|\*)(-?)((?:[0-9A-Za-z-\.\+\*]*)*))/mi,
  // The regular expression used to check the commit message for the presence of a bump version using semver syntax that will be used once the release completes (match order must be maintained)
  bumpVersionSemverIncRegExp : /(bump(?:ed|ing)?)(\s*)(v)\+(major|premajor|minor|preminor|patch|prepatch|prerelease)/mi,
  // The regular expression that will be used to ignore non-error output when extracting the previous release version from Git
  prevVersionMsgIgnoreRegExp: /No names found/i,
  // Function that will return the token used for authorization of remote Git pushes (default: returns process.env.GH_TOKEN)
  gitToken : [Function],
  // Function that will return the token used for authorization of npm publish (default: returns process.env.NPM_TOKEN)
  npmToken : [Function]
}
```

###Commit:

Once the releasebot task has been registered commit datails are captured and made available via `releasebot.config('releasebot.commit')` (synonymous with `grunt.config.get('releasebot.commit')` when using Grunt)

```js
{
  // Same as corresponding global env option
  hash : '',
  // Same as corresponding global env option
  message : '',
  // Same as corresponding global env option
  buildDir : '',
  // Same as corresponding global env option
  branch : '',
  // Same as corresponding global env option
  slug : '',
  // Username extracted via slug
  username : '',
  // Repository name extracted via slug
  reponame : '',
  // Flag indicating if the required Git token exists (extracted from global plug-in environment)
  hasGitToken : false,
  // Flag indicating if the npm token exists (extracted from global plug-in environment)
  hasNpmToken : false,
  // The indices for each version "slot" that was incremented (e.g. 0.0.1 to 0.1.2 would contain [1,2])
  versionBumpedIndices : [],
  // The indices for each version "slot" that was extracted from the previous release
  versionPrevIndices : [],
  // Previous released commit object containing similar properties as the current commit
  prev : {},
  // Next staged/bumped release commit object containing similar properties as the current commit
  next : {},
  // Same as corresponding global env option
  versionRegExp : '',
  // The release label used within the commit message
  versionLabel : 'Release',
  // The sequence of characters between the release label and the version type
  versionLabelSep : '',
  // The release version label used within the commit message
  versionType : 'v',
  // The pre-release character used within the commit message that inidcates a pre-release (e.g. extracted by env.releaseVersionRegExp, but usually a "-" as defined by semver.org)
  versionPrereleaseChar : '-',
  // The major version (e.g. 1 for version "1.2.3")
  versionMajor : 0,
  // The minor version (e.g. 2 for version "1.2.3")
  versionMinor : 0,
  // The patch version (e.g. 3 for version "1.2.3")
  versionPatch : 0,
  // The pre-release version (e.g. "beta.4" for version "1.2.3-beta.4+20201203144700")
  versionPrerelease : 0,
  // The metadata appended to the version (e.g. "+001" for version "1.0.0-alpha+001")
  versionMetadata : '',
  // The comprised version (e.g. "1.2.3-beta.4")
  version : '',
  // The versionType + version (e.g. "v1.2.3-beta.4")
  versionTag : '',
  // The match character sequence that triggered the release (e.g. "release v*.*.+")
  versionTrigger : '',
  // Updates the package and/or bower package only when descrepencies are found with relation to the current commit details (otherwise, just retrieves the package objects)
  // Function versionPkg([replacer] [, space] [, revert] [, altFunctionToWrite] [, afterWriteFunction] [,altPath] [, altBowerPath]) 
  // returns { pkg: pkgJsonObj, pkgBower: bowerJsonObj } from the pkgPath and pkgPathBower respectively
  versionPkg : [Function],
  // Array of tasks extracted from the commit message in the format: "[skip SOME_TASK]" 
  skipTasks : [],
  // Function skipTaskGen(array or string) that produces skip string(s) (e.g. skipTaskGen("clean") produces "[skip clean]")
  skipTaskGen : [Function],
  // Function skipTaskCheck(taskName) that returns true when the task is in the skipTasks
  skipTaskCheck : [Function],
  // The ID of the release (populated after release task has ran)
  releaseId : null,
  // Release assets added/uploaded as part of the release (populated after release task has ran). Each item will contain:
  // 1. "asset" : object returned by the external API (e.g. https://developer.github.com/v3/repos/releases/#upload-a-release-asset)
  // 2. "downloadUrl" : URL where the asset can be downloaded from
  releaseAssets : []
}
```

###Default task specific options:

The following options will be parsed using either [grunt template](http://gruntjs.com/api/grunt.template) or the [gulp template](https://github.com/gulpjs/gulp-util#templatestring-data) (gulp-util must be installed if used):

* `name`
* `pkgCurrVerBumpMsg`
* `pkgNextVerBumpMsg`
* `distBranchPubMsg`

The templated `data` used by Grunt's/Gulp's internal [lodash](http://lodash.com/docs/#template) processor will be set to include the following properties:

* `process` - the [node process](http://nodejs.org/api/process.html)
* `commit` - the current commit from `releasebot.config('releasebot.commit')`
* `env` - the releasebot environment from `releasebot.config('releasebot.env')`
* `options` - the current releasebot task options (shown below)

```js
{
  // The release's tag name 
  name : '<%= commit.versionTag %>',
  // Commit message used when the package version does not match the version being released and needs to be updated
  pkgCurrVerBumpMsg : 'releasebot: Updating <%= env.pkgPath %> version to match release version <%= commit.version %> <%= commit.skipTaskGen(options.releaseSkipTasks) %>',
  // Commit message used for incrementing to the next release version once the current release completes (null to disable feature)
  pkgNextVerBumpMsg : 'releasebot: Bumping <%= env.pkgPath %> version to <%= commit.next.version %> <%= commit.skipTaskGen(options.releaseSkipTasks) %>',
  // Commit message used when publishing to the distribution branch
  distBranchPubMsg : 'releasebot: Publishing <%= commit.version %> <%= commit.skipTaskGen(options.releaseSkipTasks) %>',
  // The package replacer option sent into JSON.stringify during package version updates
  pkgJsonReplacer : null,
  // The package space option sent into JSON.stringify during package version updates
  pkgJsonSpace : 2,
  // The host name of the Git provider (null will use generic Git releases)
  gitHostname : 'github',
  // The repository name
  repoName : 'origin',
  // The repository user that will be used during remote updates
  repoUser : 'releasebot',
  // The repository email that will be used during remote updates
  repoEmail : 'releasebot@example.org',
  // Change log file that will contain change details since the last release and used as the release description markdown (null to skip)
  chgLog : 'HISTORY.md',
  // Authors log that will contain all the authors of the project (null to skip)
  authors : 'AUTHORS.md',
  // The Git format that will be used for each line in the change log 
  chgLogLineFormat : '  * %s',
  // Flag to indicate that the release will fail when the change log cannot be validated
  chgLogRequired : true,
  // Array of regular expressions that will be used to against each line of the change log that when matched will be removed
  // - array elements can be a regular expression or a string (strings will be escaped before the final expression is applied)
  // - array elements will be concatenated via OR in the final expression that is applied
  // - any flags used within a passed regular expression will not be applied
  // - matches for each array element will be case-insensitive
  // - the changelog entry will always be present, even if it's not passed- removes lines with [skip changelog]
  // - if you don't want commit messages that are releasebot generated to show up in your change log make sure to include a unique key in the appropriate message options as well as one of the array elements (default will exclude)
  chgLogSkipRegExps : [ 'releasebot: ' ],
  // Flag to indicate that the release will fail when the authors log cannot be validated
  authorsRequired : false,
  // Regular expression that will be used to skip individual lines from being used within the authors log
  authorsSkipLineRegExp : null,
  // The branch that will be used to distribute released pages/documentation or other distribution assets to (null to skip)
  distBranch : 'gh-pages',
  // The directory that will be used to distribute released pages/documentation and distribution assets from (path is relative to buildDir)
  distDir : 'dist',
  // Regular expression that will be used to check the error output of a Git fetch for the distBranch, when there's a match an attempt will be made to create the distBranch
  distBranchCreateRegExp : /Couldn't find remote ref/i,
  // Regular expression that will be used to exclude directories from distributed assets within the distDir
  distExcludeDirRegExp : /.?node_modules.?/gmi,
  // Regular expression that will be used to exclude files from distributed assets within the distDir
  distExcludeFileRegExp : /.?\.zip|tar.?/gmi,
  // The compression ratio for which the distDir will be archived
  distAssetCompressRatio : 9,
  // The directory that will be used when creating the asset archives (releative to the commit.buildDir)
  distAssetDir : '..',
  // Function that will be called for each distAssetUpdateFiles 
  // distAssetUpdateFunction(contents, path) and returning customized content for the specified distribution asset that will be overwritten before the release assets are generated
  distAssetUpdateFunction : null,
  // Array of file paths that will be read/written to after distAssetUpdateFunction
  distAssetUpdateFiles : [],
  // Function that will be called for each distBranchUpdateFiles
  // distBranchUpdateFunction(contents, path) and returning customized content for the specified distribution branch that will be overwritten before the published/pushed to the specified branch
  distBranchUpdateFunction : null,
  // Array of file paths that will be read/written to after distBranchUpdateFunction
  distBranchUpdateFiles : [],
  // The strategy/order in which roll back actions will be executed ("stack" or "queue")  
  rollbackStrategy : 'queue',
  // Number of milliseconds that an asynchronous rollback action will wait for completion before throwing an error
  rollbackAsyncTimeout : 60000,
  // Number of milliseconds that an asynchronous step will wait for completion before throwing an error
  asyncTimeout : 60000,
  // Tasks names that will be skipped when releasebot performs commits for package version bumps, publish branch changes, etc. Default: http://docs.travis-ci.com/user/how-to-skip-a-build/
  releaseSkipTasks : [ 'ci' ],
  // The optional npm publish tag
  npmTag : '',
  // The registry URL to use when publishing to npm
  npmRegistryURL : 'https://registry.npmjs.org'
}
```

## API

releasebot can be used with or wihout external use of it's API
