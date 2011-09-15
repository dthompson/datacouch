/**  Creates databases for users
  *  Usage: export DATACOUCH_DATABASE="http://admin:admin@yourcouch/datacouch"  then "node provision_databases.js"
  *  Author: Max Ogden (@maxogden)
 **/
 
if(!process.env['DATACOUCH_ROOT'] || !process.env['DATACOUCH_VHOST']) throw ("OMGZ YOU HAVE TO SET $DATACOUCH_ROOT and $DATACOUCH_VHOST");

var follow = require('follow')
  , request = require('request')
  , couchapp = require('couchapp')
  , deferred = require('deferred')
  , http = require('http')
  , path = require('path')
  , url = require('url')
  , _ = require('underscore')
  ;

var configURL = url.parse(process.env['DATACOUCH_ROOT'] + "/datacouch")
  , vhostDomain = process.env['DATACOUCH_VHOST']
  , couch = configURL.protocol + "//" + configURL.host
  , db = couch + configURL.pathname
  , h = {"Content-type": "application/json", "Accept": "application/json"}
  ;

follow({db:db, include_docs:true}, function(error, change) {
  if (error || change.deleted || !("doc" in change)) return;
  if (!("type" in change.doc)) return;
  if (change.doc.type !== "database") return;
  
  var doc = change.doc
    , dbName = doc._id
    , dbPath = couch + "/" + dbName
    ;

  _(doc.apps).each(function(app) {
    var start_time = new Date();
    function done() { console.log("installed " + app.ddoc + " into " + dbPath + " in " + (new Date() - start_time) + "ms") }
    checkExistenceOf(dbPath + "/_design/" + app.ddoc).then(function(status) {
      if(status === 404) {
        replicate("apps", dbPath, "_design/" + app.ddoc).then(done);
        addVhost(doc.user + "-" + app.ddoc + "." + vhostDomain, "/" + dbName + "/_design/" + app.ddoc + "/_rewrite")
      };
    })
  })
  
  checkExistenceOf(dbPath).then(function(status) {
    if(status === 404) {
      console.log('creating ' + dbName);
      var start_time = new Date();
      createDB(dbPath).then(function(response) {
        function done() { console.log("created " + dbName + " in " + (new Date() - start_time) + "ms") }
        if (doc.forkedFrom) {
          replicate(doc.forkedFrom, dbName).then(done);
        } else {
          pushCouchapp("../../db.js", couch + "/" + dbName).then(done);
        }
        setAdmin(dbName, doc.couch_user); 
      })
    }
  })
})

function absolutePath(pathname) {
  if (pathname[0] === '/') return pathname
  return path.join(process.env.PWD, path.normalize(pathname));
}

function pushCouchapp(app, target) {
  var dfd = deferred();
  couchapp.createApp(require(absolutePath(app)), target, function (app) { app.push(function(resp) { dfd.resolve() }) })
  return dfd.promise();
}

function replicate(source, target, ddoc) {
  var dfd = deferred();
  var reqData = {"source": source,"target": target};
  if (ddoc) reqData["doc_ids"] = [ddoc];
  request({uri: couch + "/_replicate", method: "POST", headers: h, body: JSON.stringify(reqData)}, function (err, resp, body) {
    if (err) throw new Error('ahh!! ' + err);
    var response = JSON.parse(body);
    if (response.doc_write_failures > 0) throw new Error('error creating: ' + body);
    dfd.resolve(response);
  })
  return dfd.promise();
}

function checkExistenceOf(url) {
  var dfd = deferred();
  request({uri: url, method: "HEAD", headers: h}, function(err, resp, body) {
    dfd.resolve(resp.statusCode);
  })
  return dfd.promise();
}

function createDB(url) {
  var dfd = deferred();
  request({uri: url, method: "PUT", headers: h}, function (err, resp, body) {
    if (err) throw new Error('ahh!! ' + err);
    try {
      var response = JSON.parse(body);
    } catch(e) {
      var response = {"ok": true};
    }
    if (!response.ok) throw new Error(url + " - " + body);
    dfd.resolve(resp.statusCode);
  })
  return dfd.promise();
}

function addVhost(url, couchapp) {
  var dfd = deferred();
  request({uri: couch + "/_config/vhosts/" + encodeURIComponent(url), method: "PUT", headers: h, body: JSON.stringify(couchapp)}, function (err, resp, body) {
    if (err) throw new Error('ahh!! ' + err);
    dfd.resolve(body);
  })
  return dfd.promise(); 
}

function setAdmin(dbName, username) {
  var dfd = deferred();
  var data = {"admins":{"names":[username],"roles":[]},"members":{"names":[],"roles":[]}};
  request({uri: couch + "/" + dbName + "/_security", method: "PUT", headers: h, body: JSON.stringify(data)}, function (err, resp, body) {
    if (err) throw new Error('ahh!! ' + err);
    var response = JSON.parse(body);
    if (!response.ok) throw new Error('error setting admin: ' + body);
    dfd.resolve(response);
  })
  return dfd.promise(); 
}