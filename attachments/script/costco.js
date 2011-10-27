// adapted from https://github.com/harthur/costco. heather rules

var costco = function() {
  
  function evalFunction(funcString) {
    try {
      eval("var editFunc = " + funcString);
    } catch(e) {
      return {errorMessage: e+""};
    }
    return editFunc;
  }
  
  function previewTransform(docs, editFunc, currentColumn) {
    var preview = [];
    mapDocs(_.clone(docs), editFunc, function(updated) {
      for (var i = 0; i < updated.docs.length; i++) {      
        var before = docs[i]
          , after = updated.docs[i]
          ;
        if (!after) after = {};
        if (currentColumn) {
          preview.push({before: JSON.stringify(before[currentColumn]), after: JSON.stringify(after[currentColumn])});      
        } else {
          preview.push({before: JSON.stringify(before), after: JSON.stringify(after)});      
        }
      }
      util.render('editPreview', 'expression-preview-container', {rows: preview});
    });
  }

  function mapDocs(docs, editFunc, callback) {
    var edited = []
      , failed = []
      , updatedDocs = []
      ;
  
    var q = async.queue(function (doc, done) {
      try {
        editFunc(_.clone(doc), function(updated) {
          if (updated && !_.isEqual(updated, doc)) {
            edited.push(updated);
          }
          updatedDocs.push(updated);
          done();
        });
      } catch(e) {
        failed.push(doc)
        done(e);
      }
    }, 20);

    q.drain = function() {
      callback({
        edited: edited, 
        docs: updatedDocs, 
        failed: failed
      })
    }

    _.map(docs, function(doc) {
      q.push(doc, function(err) {
        if (err) console.log('processing error', err)
      })
    })
  }
  
  function updateDocs(editFunc) {
    var dfd = $.Deferred();
    util.notify("Download entire database into Recline. This could take a while...", {persist: true, loader: true});
    couch.request({url: app.dbPath + "/json"}).then(function(docs) {
      util.notify("Updating " + docs.docs.length + " documents. This could take a while...", {persist: true, loader: true});
      mapDocs(docs.docs, editFunc, function(transformed) {
        uploadDocs(transformed.edited).then(
          function(updatedDocs) { 
            util.notify(updatedDocs.length + " documents updated successfully");
            recline.initializeTable(app.offset);
            dfd.resolve(updatedDocs);
          },
          function(err) {
            dfd.reject(err);
          }
        );
      });
    });
    return dfd.promise();
  }
  
  function updateDoc(doc) {
    return couch.request({type: "PUT", url: app.dbPath + "/" + doc._id, data: JSON.stringify(doc)})    
  }

  function uploadDocs(docs) {
    var dfd = $.Deferred();
    if(!docs.length) dfd.resolve("Failed: No docs specified");
    couch.request({url: app.dbPath + "/_bulk_docs", type: "POST", data: JSON.stringify({docs: docs})})
      .then(
        function(resp) {ensureCommit().then(function() { 
          var error = couch.responseError(resp);
          if (error) {
            dfd.reject(error);
          } else {
            dfd.resolve(resp);            
          }
        })}, 
        function(err) { dfd.reject(err.responseText) }
      );
    return dfd.promise();
  }
  
  function ensureCommit() {
    return couch.request({url: app.dbPath + "/_ensure_full_commit", type:'POST', data: "''"});
  }
  
  function deleteColumn(name) {
    var deleteFunc = function(doc, emit) {
      delete doc[name];
      emit(doc);
    }
    return updateDocs(deleteFunc);
  }
  
  function uploadCSV(file) {
    if (file) {
      util.notify("Uploading file...", {persist: true, loader: true});
      
      var xhr = new XMLHttpRequest();
      xhr.upload.onprogress = function (e) {
        var percent = (e.loaded / e.total) * 100;
        util.notify("Uploading file... " + percent + "%", {persist: true, loader: true});
      }
      xhr.onload = function (e) { 
        var resp = JSON.parse(e.currentTarget.response)
          , status = e.currentTarget.status;
        if (status > 299) { 
          util.notify("Error! " + e.error);
        } else if (resp[0].error) {
          util.notify("Error! " + JSON.stringify(resp[0]), {showFor: 6000});
        } else {
          if (resp.length > 499) {
            util.notify("Here are the first " + resp.length + 
            " new documents. The rest of the CSV data is being processed and will appear in a few minutes.", {showFor: 6000});
          } else {
            util.notify(resp.length + " documents created successfully");
          }
        }
        recline.initializeTable(app.offset);
      }
      xhr.open('PUT', app.baseURL + "api/upload/" + app.datasetInfo._id);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.send(file)
      
      // var reader = new FileReader();
      // reader.readAsText(file);
      // reader.onload = function(event) {
      //   couch.request({
      //     url: app.baseURL + "api/upload/" + app.datasetInfo._id,
      //     type: "POST", 
      //     data: event.target.result
      //   }).then(function(done) {
      //     util.notify("Data uploaded successfully!");
      //     recline.initializeTable(app.offset);
      //   })
      // };
    } else {
      util.notify('File not selected. Please try again');
    }
  };

  return {
    evalFunction: evalFunction,
    previewTransform: previewTransform,
    mapDocs: mapDocs,
    updateDocs: updateDocs,
    updateDoc: updateDoc,
    uploadDocs: uploadDocs,
    deleteColumn: deleteColumn,
    ensureCommit: ensureCommit,
    uploadCSV: uploadCSV 
  };
}();