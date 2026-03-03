/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("bench_collection_01")

  // update
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "ytwie8wi",
    "name": "mode",
    "type": "select",
    "required": true,
    "presentable": false,
    "unique": false,
    "options": {
      "maxSelect": 1,
      "values": [
        "random",
        "all",
        "jury"
      ]
    }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("bench_collection_01")

  // update
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "ytwie8wi",
    "name": "mode",
    "type": "select",
    "required": true,
    "presentable": false,
    "unique": false,
    "options": {
      "maxSelect": 1,
      "values": [
        "random",
        "all"
      ]
    }
  }))

  return dao.saveCollection(collection)
})
