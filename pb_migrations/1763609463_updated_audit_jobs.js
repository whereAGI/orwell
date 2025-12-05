/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
    const dao = new Dao(db)
    const collection = dao.findCollectionByNameOrId("sx9qq5ieupmiet8")

    // add
    collection.schema.addField(new SchemaField({
        "system": false,
        "id": "msg_field",
        "name": "message",
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
    collection.schema.removeField("msg_field")

    return dao.saveCollection(collection)
})
