/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("bench_collection_01")

  // remove
  collection.schema.removeField("bench_name_f1")

  // remove
  collection.schema.removeField("bench_mode_f2")

  // remove
  collection.schema.removeField("bench_judges_f3")

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "a22mhmst",
    "name": "name",
    "type": "text",
    "required": true,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "pattern": ""
    }
  }))

  // add
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

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "3b3hpne2",
    "name": "judge_model_ids",
    "type": "json",
    "required": true,
    "presentable": false,
    "unique": false,
    "options": {
      "maxSize": 2000000
    }
  }))

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "l6kllpi8",
    "name": "foreman_model_id",
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
  const collection = dao.findCollectionByNameOrId("bench_collection_01")

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "bench_name_f1",
    "name": "name",
    "type": "text",
    "required": true,
    "presentable": true,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "pattern": ""
    }
  }))

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "bench_mode_f2",
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

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "bench_judges_f3",
    "name": "judge_model_ids",
    "type": "json",
    "required": true,
    "presentable": false,
    "unique": false,
    "options": {
      "maxSize": 2000000
    }
  }))

  // remove
  collection.schema.removeField("a22mhmst")

  // remove
  collection.schema.removeField("ytwie8wi")

  // remove
  collection.schema.removeField("3b3hpne2")

  // remove
  collection.schema.removeField("l6kllpi8")

  return dao.saveCollection(collection)
})
