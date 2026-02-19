/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("models")

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "judge_sys_prompt",
    "name": "system_prompt",
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
  const collection = dao.findCollectionByNameOrId("models")

  // remove
  collection.schema.removeField("system_prompt")

  return dao.saveCollection(collection)
})
