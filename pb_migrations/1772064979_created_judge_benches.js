/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
    const collection = new Collection({
        "id": "bench_collection_01",
        "created": "2026-02-26 11:16:19.000Z",
        "updated": "2026-02-26 11:16:19.000Z",
        "name": "judge_benches",
        "type": "base",
        "system": false,
        "schema": [
            {
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
            },
            {
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
            },
            {
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
            }
        ],
        "indexes": [],
        "listRule": null,
        "viewRule": null,
        "createRule": null,
        "updateRule": null,
        "deleteRule": null,
        "options": {}
    });

    return Dao(db).saveCollection(collection);
}, (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("bench_collection_01");

    return dao.deleteCollection(collection);
})
