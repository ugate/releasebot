<!-- Commit df1310c38cde99bd5411994739c0d107d39534c8 -->
  * Release v0.1.0
  *  Added task option npmRegistryURL that gets passed to npm.registry.adduser when publishing to npm
  * 
  * Rollback: Updating  version to match release version 0.1.0 [skip ci]
  * Updating  version to match release version 0.1.0 [skip ci]
  * 
  * Bumping  version to 0.1.1 [skip ci]
  * Rollback: Updating  version to match release version 0.1.0 [skip ci]
  * Updating  version to match release version 0.1.0 [skip ci]
  * Rollback: Updating  version to match release version 0.1.0 [skip ci]
  * Updating  version to match release version 0.1.0 [skip ci]
  *  Change log now removes any prior unsuccessful release triggers from the change log- even if they used a different format than the current one
  *  Change log now removes any prior release triggers from the change log that did not successfully complete
  *  Doc updates
  *  Added commit.versionTrigger to expose the portion of a commit message that triggered a release Updated change log generation so that it will include the evaluated version rather than the raw version in the trigger
  * Relaxed pre-release versions so they are more inline with semver
  * Fixed reference issue in coopt.getEnv()
  * Fixed issue with releasebot namespace
  * Added smoke tests (incomplete) Fixed a few minor bugs
  * Fixed issue with missing next version
  * Updating  version to match release version 0.0.5 [skip ci]