/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("models");

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "reasoning_effort_idx", 
    "name": "reasoning_effort",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "pattern": ""
    }
  }));

  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("models");

  // remove the field
  collection.schema.removeField("reasoning_effort_idx");

  return dao.saveCollection(collection);
})