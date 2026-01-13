/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("sx9qq5ieupmiet8")

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "pladzlan",
    "name": "system_prompt_snapshot",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "pattern": ""
    }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("sx9qq5ieupmiet8")

  // remove
  collection.schema.removeField("pladzlan")

  return dao.saveCollection(collection)
})
