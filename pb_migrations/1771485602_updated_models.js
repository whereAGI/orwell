/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("models")

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "model_temperature",
    "name": "temperature",
    "type": "number",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": 0,
      "max": 2,
      "noDecimal": false
    }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("models")

  // remove
  collection.schema.removeField("temperature")

  return dao.saveCollection(collection)
})
