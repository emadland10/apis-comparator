const { Command } = require('commander');
const program = new Command();
const axios = require('axios');
const diff = require('json-diff');
const wildcard = require('wildcard');
const objectPath = require("object-path");
const { version, name, description } = require('./package.json');

program
    .name(name)
    .description(description)
    .version(version)
    .requiredOption('-o, --original <url>', 'Original API URL')
    .requiredOption('-t, --test <url>', 'Test API URL')
    .option('-e, --endpoint [endpoint]', 'Endpoint', '')
    .option('-m, --method [method]', 'HTTP method', 'get')
    .option('-c, --config <path>', 'Path to config file')
    .parse();
const options = program.opts();

async function getResponse(url, method) {
    let response
    try{
        response = await axios({ url, method });
        return response.data;
    }catch(e){
        console.log(e);
    }
    return response;
}



async function compareResponses(originalUrl, testUrl, endpoint, method) {
    let originalResponse = await getResponse(originalUrl + endpoint, method);
    let testResponse = await getResponse(testUrl + endpoint, method);
    if (options.config) {
        let configFile;
        try {
            configFile = require(options.config);
        } catch (error) {
            console.error('Error: Invalid JSON in config file.');
            process.exit(1);
        }
        originalResponse = updateResponse(originalResponse, configFile);
        testResponse = updateResponse(testResponse, configFile);
    }

    const differences = diff.diffString(originalResponse, testResponse);
    console.log(differences);
}


function getDeepKeys(obj) {
    let keys = [];
    for (let key in obj) {
        keys.push(key);
        if (typeof obj[key] === "object") {
            let subkeys = getDeepKeys(obj[key]);
            keys = keys.concat(subkeys.map(function (subkey) {
                return key + "." + subkey;
            }));
        }
    }
    return keys;
}

function updateResponse(response , config) {

    for (let path of getDeepKeys(response)) {
        if (config.ignores) {
            for (let ignore of config.ignores) {
                if (wildcard(ignore, path)) {
                    objectPath.set(response, path, "ignored");
                }
            }
        }

        if (config.ignores) {
            for (let sort of config.sorts) {
                if (wildcard(sort, path)) {
                    const original = objectPath.get(response, path);
                    if (Array.isArray(original)) {
                        objectPath.set(response, path, original.sort((a, b) => (a[sort.sortField] > b[sort.sortField]) ? 1
                            : ((b[sort.sortField] > a[sort.sortField]) ? -1 : 0)));
                    }
                    objectPath.set(response, path, "ignored");
                }
            }
        }

        if (config.toStrings) {
            for (let filter of config.toStrings) {
                if (wildcard(filter, path)) {
                    const original = objectPath.get(response, path);
                    objectPath.set(response, path, original.toString());
                }
            }
        }

        if (config.roundNumbers) {
            for (let filter of config.roundNumbers) {
                if (wildcard(filter, path)) {
                    const original = objectPath.get(response, path);
                    objectPath.set(response, path, Math.round(original));
                }
            }
        }

        if (config.typeOnly){
            for (let filter of config.typeOnly) {
                if (wildcard(filter, path)) {
                    const original = objectPath.get(response, path);
                    objectPath.set(response, path, typeof original);
                }
            }
        }

    }
    return response;
}

compareResponses(options.original, options.test, options.endpoint, options.method);