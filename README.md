# releasebot
[![NPM version](https://badge.fury.io/js/releasebot.png)](http://badge.fury.io/js/releasebot) [![Build Status](https://travis-ci.org/ugate/releasebot.png?branch=master)](https://travis-ci.org/ugate/releasebot) [![Dependency Status](https://david-dm.org/ugate/releasebot.png)](https://david-dm.org/ugate/releasebot) [![devDependency Status](https://david-dm.org/ugate/releasebot/dev-status.png)](https://david-dm.org/ugate/releasebot#info=devDependencies)

Git commit message triggered grunt task that tags a release (GitHub Release API supported), generates/uploads a release distribution asset archive and publishes a distribution asset's content to a specified branch

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
4. Default option value

###Default global options:

```JavaScript
{
  pkg : grunt.config('pkgFile') || 'package.json',
  buildDir : process.cwd(),
  branch : '', // extracted from last commit via Git
  commitNumber : '', // extracted from last commit via Git
  commitMessage : '', // extracted from last commit via Git
  repoSlug : '' // extracted from Git
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
  destExcludeFileRegExp : /.?\.zip.?/gmi,
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
