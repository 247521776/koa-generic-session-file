"use strict";

let path = require("path");
let fs = require("fs");
let EventEmitter = require("events");

let promisify = require("es6-promisify");
// glob.glob here is just exploiting a hidden property of glob to allow
// me to stub this for testing. I know it's an old API compatibility
// feature.
let glob = promisify(require("glob").glob);
let mkdirp = promisify(require("mkdirp"));
let debug = require("debug")("koa-session-file-store");

let readFile = promisify(fs.readFile);
let writeFile = promisify(fs.writeFile);
let stat = promisify(fs.stat);
let unlink = promisify(fs.unlink);


class FileStore extends EventEmitter {
  constructor(options) {
    super();
    this.emit("connect");
    this.options = options || {};
    this.options.sessionDirectory = path.resolve(
      this.options.sessionDirectory || "./sessions");
  }

  /**
   * Load a session file from the sessionDirectory called <sid>.json, return
   * parsed session data
   * @param  {string} sid Unique sessionID (generated by koa-generic-session)
   * @return {object} Parsed session object, or null if no session file exists
   */
  get(sid) {
    let sessionGlob = path.join(this.options.sessionDirectory,
      `${sid}__*.json`);
    let sessionPath;

    return glob(sessionGlob, {nonull: false}).then(files => {
      if (files.length === 0) {
        debug("No session available for user");
        return true;
      }
      sessionPath = files[0];
      return hasSessionExpired(sessionPath, this.options.sessionDirectory);
    }).then(sessionExpired => {
      if (!sessionPath) {
        return null;
      }
      let sessionFilePath = path.resolve(this.options.sessionDirectory,
        sessionPath);
      if (sessionExpired) {
        debug("Session expired, removing session file");
        return unlink(sessionFilePath);
      }
      return readFile(sessionFilePath, "utf8");
    }).then(content => {
      if (!content) {
        return null;
      }
      try {
        return JSON.parse(content);
      } catch (err) {
        // Ignore parsing error
        debug("Parse session error: %s", err.message);
        return null;
      }
    });
  }

  set(sid, session, ttl) {
    let sessionFilePath = path.resolve(this.options.sessionDirectory,
      `${sid}__${ttl}.json`);
    return mkdirp(this.options.sessionDirectory).then(() => {
      return writeFile(sessionFilePath, JSON.stringify(session));  
    });
  }

  destroy(sid) {
    let sessionGlob = path.join(this.options.sessionDirectory,
      `${sid}__*.json`);
    return glob(sessionGlob, {nonull: false}).then((files) => {
      if (files.length === 0) {
        return null;
      }
      return unlink(files[0]);
    });
  }
}

/*
 * Will return true if the number of milliseconds between the current time and
 * the last modified time of the session file is greater than the TTL value
 * kludgily stored in the session's filename.
 */
function hasSessionExpired(sessionPath, sessionsDirectory) {
  let ttl = parseInt(path.basename(sessionPath).split("__")[1]);
  return stat(path.resolve(sessionsDirectory, sessionPath))
    .then(stats => {
      return Date.now() - stats.mtime > ttl;
    }).catch(() => {
      return true;
    });
}

module.exports = FileStore;
