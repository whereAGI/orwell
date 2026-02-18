/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "1t8lm216o6gtwm1",
    "created": "2026-02-18 07:37:44.877Z",
    "updated": "2026-02-18 07:37:44.877Z",
    "name": "models",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false,
        "id": "xfmoqhtr",
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
      },
      {
        "system": false,
        "id": "amfftw8x",
        "name": "category",
        "type": "select",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "maxSelect": 1,
          "values": [
            "target",
            "judge"
          ]
        }
      },
      {
        "system": false,
        "id": "7abzymgj",
        "name": "provider",
        "type": "select",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "maxSelect": 1,
          "values": [
            "openai",
            "openrouter",
            "ollama",
            "custom"
          ]
        }
      },
      {
        "system": false,
        "id": "pfbgjhfq",
        "name": "base_url",
        "type": "text",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "min": null,
          "max": null,
          "pattern": ""
        }
      },
      {
        "system": false,
        "id": "tjwan8wj",
        "name": "model_key",
        "type": "text",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "min": null,
          "max": null,
          "pattern": ""
        }
      },
      {
        "system": false,
        "id": "zttpg7y7",
        "name": "api_key",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {
          "min": null,
          "max": null,
          "pattern": ""
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
  const collection = dao.findCollectionByNameOrId("1t8lm216o6gtwm1");

  return dao.deleteCollection(collection);
})
