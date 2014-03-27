# releasebot
[![NPM version](https://badge.fury.io/js/releasebot.png)](http://badge.fury.io/js/releasebot) [![Build Status](https://travis-ci.org/ugate/releasebot.png?branch=master)](https://travis-ci.org/ugate/releasebot) [![Dependency Status](https://david-dm.org/ugate/releasebot.png)](https://david-dm.org/ugate/releasebot) [![devDependency Status](https://david-dm.org/ugate/releasebot/dev-status.png)](https://david-dm.org/ugate/releasebot#info=devDependencies)

**releasebot** is a [Grunt](http://gruntjs.com/) task for triggering a release on a predefined commit message. The task performs the following actions:

1. Capture commit details from Git (on task registration)
2. Check for <a href="#default-task-specific-options">release trigger</a> within commit message
3. Capture/write change log and authors (if directed) &dagger;
4. Update package version &dagger; &hearts;
5. Generate release archive asset &dagger;
6. Release/Tag version (with change log as description) &hearts;
7. Upload archive asset &#9679; &hearts;
8. Publish/Push release archive asset contents to distribution branch &hearts;
9. Publish release archive asset to <a href="https://www.npmjs.org/">npm</a> &hearts;

&dagger; Performed when release is triggered <br/>
&#9679; GitHub only <br/>
&hearts; Failure will result in the following rollback sequence:

1. Remove remote release archive asset &#9679; and tagged release
2. Revert published archive asset contents in distribution branch
3. Revert package version

## Getting Started
If you haven't used [Grunt](http://gruntjs.com/) before, be sure to check out the [Getting Started](http://gruntjs.com/getting-started) guide, as it explains how to create a [Gruntfile](http://gruntjs.com/sample-gruntfile) as well as install and use Grunt plugins. Once you're familiar with that process, you may install this plugin with this command:

```shell
npm install releasebot --save-dev
```

Once the plugin has been installed, it may be enabled inside your Gruntfile with this line of JavaScript:

```shell
grunt.loadNpmTasks('releasebot');
```

## Usage Examples

Each commit message will be checked for the presense of a version to release. The default expression checks for `release v` followed by a <a href="http://semver.org/">semantic compliant version</a> or a `+` or `*` within the appropriate version *slot* indicating the version should be either *incremented* by one or that the value should be replaces by the *last/current* released version (respectively).

The commit message below will result in a release of version `1.0.0` (surrounding text will be ignored):
```shell
This is release v1.0.0 of my app
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

## Options

The following **global options** can be set using one of the following techniques (in order of presidence):

1. Via `grunt.config.set('releasebot', options)`
2. Passed in from the command line `grunt releasebot --releasebot.theoptionname=THE_OPTION_VALUE`
3. Automatically from the <a href="http://docs.travis-ci.com/user/ci-environment/#Environment-variables">Travis-CI environmental variables</a>
4. Default option value or extracted from Git

###Default global options:

```JavaScript
{
  // the path to the project package file (blank/null prevents npm publish)
  pkgPath : grunt.config('pkgFile') || 'package.json',
  // CLI executable for Git operations
  gitCliSubstitute : 'git',
  // Directory where the build will take place
  buildDir : process.cwd(),
  // Git branch that will be released (default: extracted from current checkout)
  branch : '',
  // The repository slug the release is for (default: extracted from current checkout)
  repoSlug : '',
  // The commit message that will be checked for release trigger (default: extracted from last commit)
  commitNumber : '',
  // The commit message that will be checked for release trigger (default: extracted from last commit)
  commitMessage : ''
}
```

Global options are set once the releasebot task is registered. After registration `grunt.config.get('releasebot')` will return the global options above with one additional **read-only** property named `commit`:

```JavaScript
{
  ...
  commit :
  {
     // Same as corresponding option value
     gitCliSubstitute : '',
     // Same as corresponding option value
     pkgPath : '',
     // Same as corresponding option value or Git extracted value
     number : '',
     // Same as corresponding option value
     buildDir : '',
     // Same as corresponding option value or Git extracted value
     branch : '',
     // Same as corresponding option value or Git extracted value
     slug : '',
     // Username extracted via slug
     username : '',
     // Repository name extracted via slug
     reponame : '',
     // Same as corresponding option value or Git extracted value
     message : '',
     // The indices for each version "slot" that was incremented (e.g. 0.0.1 to 0.1.2 would contain [1,2])
     versionBumpedIndices : [],
     // The indices for each version "slot" that was extracted from the last release
     versionLastIndices : [],
     // Last released commit object containing similar properties as the current commit
     lastCommit : {},
     // The release label used within the commit message
     versionLabel : 'Release',
     // The release version label used within the commit message
     versionType : 'v',
     // The pre-release type used within the commit message (e.g. "beta" for version "1.0.0-beta.1")
     versionPrereleaseType : undefined,
     // The major version (e.g. 1 for version "1.2.3")
     versionMajor : 0,
     // The minor version (e.g. 2 for version "1.2.3")
     versionMinor : 0,
     // The patch version (e.g. 3 for version "1.2.3")
     versionPatch : 0,
     // The pre-release version (e.g. 4 for version "1.2.3-beta.4")
     versionPrerelease : 0,
     // The comprised version (e.g. "1.2.3-beta.4")
     version : '',
     // The versionType + version (e.g. "v1.2.3-beta.4")
     versionTag : '',
     // Function versionPkg([isSet][,isRevert]) that returns {reverted: Boolean, updated: Boolean, pkg: Object} with the pkgPath JSON contents
     versionPkg : [Function],
     // Array of tasks extracted from the commit message in the format: "[skip SOME_TASK]" 
     skipTasks : [],
     // Function skipTaskGen(taskName) that produces a skip string (e.g. skipTaskGen("clean") produces "[skip clean]")
     skipTaskGen : [Function],
     // Function skipTaskCheck(taskName) that returns true when the task is in the skipTasks
     skipTaskCheck : [Function],
     // The ID of the release (populated after release task has ran)
     releaseId : null,
     // The URL of the release archive asset (populated after release task has ran)
     releaseAssetUrl : '',
     // The asset object returned by the release asset process (populated after release task has ran)
     releaseAsset : null
  }
}
```

###Default task specific options:

```JavaScript
{
  // regular expression that will be used against the commit message to determine if a release needs to be made
  releaseVersionRegExp : /(released?)\s*(v)((?:(\d+|\+|\*)(\.)(\d+|\+|\*)(\.)(\d+|\+|\*)(?:(-)(alpha|beta|rc?)(?:(\.)?(\d+|\+|\*))?)?))/mi,
  // the branch that will be used to push the destDir to (blank/null will skip the dest push)
  destBranch : 'gh-pages',
  // the directory that will be used as the contents of the release asset and will be pushed to the destBranch
  destDir : 'dist',
  // RegExp used to exclude dest directories within destDir
  destExcludeDirRegExp : /.?node_modules.?/gmi,
  // RegExp used to exclude dest files within destDir
  destExcludeFileRegExp : /.?\.zip|tar.?/gmi,
  // Change log file that will include all the commit messages since the last release (blank/null will prevent change log creation)
  chgLog : 'HISTORY.md',
  // Authors file that will include all the authors since the last release (blank/null prevents authors creation)
  authors : 'AUTHORS.md',
  // The git log --pretty format that will be used for each line of the change log
  chgLogLineFormat : '  * %s',
  // Release fails when the change log fails to be created?
  chgLogRequired : true,
  // Lines in the change log that should not be included (commit messages with "[skip CHANGELOG]" within it's contents will be excluded by default)
  chgLogSkipLineRegExp : /.*(?:(released?)\s*(v)((?:(\d+|\+|\*)(\.)(\d+|\+|\*)(\.)(\d+|\+|\*)(?:(-)(alpha|beta|rc?)(?:(\.)?(\d+|\+|\*))?)?)))|(\[skip\s*CHANGELOG\]).*\r?\n'/mi,
  // Release fails when the authors log fails to be created?
  authorsRequired : false,
  // Lines in the authors log that should not be included
  authorsSkipLineRegExp : null,
  // Release asset format (zip or tar)
  distAssetFormat : 'zip',
  // Release asset compression ratio
  distAssetCompressRatio : 9,
  // The Git host being used
  gitHostname : 'github',
  // Function that will be called for each distAssetUpdateFiles passing: contents, path, commit and returning customized content for the specified distribution asset that will be overwritten before the release asset is pushed
  distAssetUpdateFunction : null,
  // Array of file paths that will be read/written to before/after distAssetUpdateFunction
  distAssetUpdateFiles : []
}
```
