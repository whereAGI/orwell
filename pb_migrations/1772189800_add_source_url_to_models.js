/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("models");

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "source_url_idx", 
    "name": "source_url",
    "type": "url",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "exceptDomains": null,
      "onlyDomains": null
    }
  }));

  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("models");

  // remove the field
  collection.schema.removeField("source_url_idx");

  return dao.saveCollection(collection);
})
