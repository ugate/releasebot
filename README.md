# releasebot
[![NPM version](https://badge.fury.io/js/releasebot.png)](http://badge.fury.io/js/releasebot) [![Build Status](https://travis-ci.org/ugate/releasebot.png?branch=master)](https://travis-ci.org/ugate/releasebot) [![Dependency Status](https://david-dm.org/ugate/releasebot.png)](https://david-dm.org/ugate/releasebot) [![devDependency Status](https://david-dm.org/ugate/releasebot/dev-status.png)](https://david-dm.org/ugate/releasebot#info=devDependencies)

**releasebot** is a [Grunt](http://gruntjs.com/) task for triggering a release when a commit message matches a predefined regular expression or when manually invoked. The task performs the following actions:

1. [Capture](https://www.kernel.org/pub/software/scm/git/docs/git-rev-parse.html) [commit](https://www.kernel.org/pub/software/scm/git/docs/git-show.html) [details](https://www.kernel.org/pub/software/scm/git/docs/git-remote.html) [from Git](https://www.kernel.org/pub/software/scm/git/docs/git-describe.html) (on task registration)
2. Check for <a href="#default-task-specific-options">release trigger</a> within commit message
3. Capture/write [change log and/or authors](https://www.kernel.org/pub/software/scm/git/docs/git-log.html) (if directed) &dagger;
4. [Generate release archive asset](https://www.kernel.org/pub/software/scm/git/docs/git-archive.html) &dagger;
5. [Release](http://developer.github.com/v3/repos/releases/#create-a-release)/[Tag](https://www.kernel.org/pub/software/scm/git/docs/git-tag.html) version (with [change log](https://www.kernel.org/pub/software/scm/git/docs/git-log.html) as description) &dagger; &hearts;
6. [Upload archive asset](http://developer.github.com/v3/repos/releases/#upload-a-release-asset) &#9679; &dagger; &hearts;
7. Publish/[Push](https://www.kernel.org/pub/software/scm/git/docs/git-push.html) release archive asset contents to distribution/pages branch (creating the branch- if needed) &dagger; &hearts;
8. [Update package version](https://www.npmjs.org/doc/cli/npm-update.html) &dagger;
9. [Publish](https://www.npmjs.org/doc/cli/npm-publish.html) release archive asset to <a href="https://www.npmjs.org/">npm</a> &dagger; &hearts;

&dagger; Performed when only when release is triggered <br/>
&#9679; GitHub only <br/>
&hearts; Failure will result in the following rollback sequence:

1. [Remove remote release archive asset](http://developer.github.com/v3/repos/releases/#delete-a-release-asset) &#9679; and [tagged](https://www.kernel.org/pub/software/scm/git/docs/git-push.html) [release](http://developer.github.com/v3/repos/releases/#delete-a-release)
2. [Revert](https://www.kernel.org/pub/software/scm/git/docs/git-revert.html) published archive asset contents in distribution/pages branch
3. [Revert package version](https://www.npmjs.org/doc/cli/npm-update.html)

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

To release version `2.0.0` when the latest release is `1.1.1` via the [grunt cli](http://gruntjs.com/using-the-cli):
```shell
grunt releasebot --releasebot.commitMessage="Release v+.0.0"
```

## Options

The following **global plug-in environment options** can be set using one of the following techniques (in order of presidence):

1. Via `grunt.config.set('releasebot.env', options)` before the releasebot task is registered
2. Passed in from the command line `grunt releasebot --releasebot.theoptionname=THE_OPTION_VALUE`
3. Automatically from the <a href="http://docs.travis-ci.com/user/ci-environment/#Environment-variables">Travis-CI environmental variables</a>
4. Default option value or extracted from Git

###Default global plug-in environment options:

Global environment options are set once the releasebot task is registered and are accessible via `grunt.config.get('releasebot.env')`

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
  // The commit message that will be checked for release trigger (default: extracted from last commit)
  commitNumber : '',
  // The commit message that will be checked for release trigger (default: extracted from last commit)
  commitMessage : '',
  // The repository slug the release is for (default: extracted from current checkout)
  repoSlug : '',
  // The regular expression that will be used to ignore output when extracting the last release version from Git
  lastVersionMsgIgnoreRegExp: /No names found/i,
  // The function that will return the token used for authentication/authorization of remote Git pushes
  gitToken: [Function]
}
```

###Commit:

Once the releasebot task has been registered commit datails are captured and made available via `grunt.config.get('releasebot.commit')`

```JavaScript
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
  // Flag indicating if the required Git token exists (extracted from global plug-in environment)
  hasGitToken : false,
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
```

###Default task specific options:

```JavaScript
{
  // The package replacer option sent into JSON.stringify during updates
  pkgJsonReplacer : null,
  // The package space option sent into JSON.stringify during updates
  pkgJsonSpace : 2,
  // The regular expression used to check the commit message for in order to trigger a release
  releaseVersionRegExp : /(released?)\s*(v)((?:(\d+|\+|\*)(\.)(\d+|\+|\*)(\.)(\d+|\+|\*)(?:(-)(alpha|beta|rc?)(?:(\.)?(\d+|\+|\*))?)?))/mi,
  // The repository name
  repoName : 'origin',
  // The repository user that will be used during remote updates
  repoUser : 'releasebot',
  // The repository email that will be used during remote updates
  repoEmail : 'releasebot@example.org',
  // The branch that will be used to distribute released documentation or other distribution assets to
  destBranch : 'gh-pages',
  // The directory that will be used to distribute released documentation or other distribution assets from
  destDir : 'dist',
  // Regular expression that will be used to check the error output of a Git fetch of destBranch, when there's a match an attempt will be made to create the destBranch
  destBranchCreateRegExp : /Couldn't find remote ref/i,
  // Regular expression that will be used to exclude directories from distributed assets within the destDir
  destExcludeDirRegExp : /.?node_modules.?/gmi,
  // Regular expression that will be used to exclude files from distributed assets within the destDir
  destExcludeFileRegExp : /.?\.zip|tar.?/gmi,
  // Change log file that will contain change details since the last release and used as the release description markdown (null to skip)
  chgLog : 'HISTORY.md',
  // Authors log that will contain all the authors of the project (null to skip)
  authors : 'AUTHORS.md',
  // The Git format that will be used for each line in the change log 
  chgLogLineFormat : '  * %s',
  // Flag to indicate that the release will fail when the change log cannot be validated
  chgLogRequired : true,
  // Regular expression that will be used to skip individual lines from being used within the change log
  chgLogSkipLineRegExp : /.*(?:(released?)\s*(v)((?:(\d+|\+|\*)(\.)(\d+|\+|\*)(\.)(\d+|\+|\*)(?:(-)(alpha|beta|rc?)(?:(\.)?(\d+|\+|\*))?)?)))|(\[skip\s*CHANGELOG\]).*\r?\n'/mi,
  // Flag to indicate that the release will fail when the authors log cannot be validated
  authorsRequired : false,
  // Regular expression that will be used to skip individual lines from being used within the authors log
  authorsSkipLineRegExp : null,
  // The format for which the destDir will be archived
  distAssetFormat : 'zip',
  // The compression ratio for which the destDir will be archived
  distAssetCompressRatio : 9,
  // The host name of the Git provider (null will use generic Git releases)
  gitHostname : 'github',
  // Function that will be called for each distAssetUpdateFiles passing: contents, path, commit and returning customized content for the specified distribution asset that will be overwritten before the release asset is pushed
  distAssetUpdateFunction : null,
  // Array of file paths that will be read/written to before/after distAssetUpdateFunction
  distAssetUpdateFiles : [],
  // The npm publish target (null to skip npm publish)
  npmTarget : '',
  // The npm publish tag
  npmTag : ''
}
```