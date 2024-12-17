const { Command } = require('commander');
const fs = require('fs');
const { minimatch } = require('minimatch')
const program = new Command();
const axios = require('axios');
const diff = require('json-diff');
const _ = require('lodash');

const { version, name, description } = require('./package.json');

program
    .name(name)
    .description(description)
    .version(version)
    .option('--mode <type>', 'mode of operation: url or file', "url")
    .requiredOption('-o, --original <string>', 'Original API URL for mode "url" or path to file for mode "file')
    .requiredOption('-t, --test <string>', 'Test API URL for mode "url" or path to file for mode "file')
    .option('-e, --endpoint [endpoint]', 'Endpoint', '')
    .option('-m, --method [method]', 'HTTP method', 'get')
    .option('-r, --retry [retry]', 'Number of retries in case of error', 1)
    .option('-n, --number [number]', 'Number of replays', 1)
    .option('-c, --config <path>', 'Path to config file', './config.json')
    .parse();
const options = program.opts();

async function getResponse(url, method) {
    let response
    try{
        response = (await axios({ url, method })).data;
    }catch(e){
        response = e.response.data;
    }
    return response;
}

async function compareResponses(originalUrl, testUrl, endpoint, method, retryCount = 0) {
    for (let i = 0; i < options.number; i++) {
        let originalResponse = (await getResponse(originalUrl + endpoint, method));
        let testResponse = (await getResponse(testUrl + endpoint, method));
        let showFullResponse = false;
        if (options.config) {
            let configFile;
            try {
                configFile = require(options.config);
                showFullResponse = configFile.showFullResponse || false;
            } catch (error) {
                console.error('Error: Invalid JSON in config file.');
                process.exit(1);
            }
            originalResponse = updateResponse(originalResponse, configFile);
            testResponse = updateResponse(testResponse, configFile);
        }
        const differences = diff.diffString(originalResponse, testResponse,{maxElisions:1, full: showFullResponse });
        if (differences && differences!=="" && (differences.includes('-  ')||differences.includes('+  '))){
            if (retryCount < options.retry) {
                console.log(`Retrying ${retryCount + 1} time`);
                return compareResponses(originalUrl, testUrl, endpoint, method, retryCount + 1);
            } else {
                console.log(`${method.toUpperCase()} ${endpoint}`)
                console.log(differences);
            }
        }
    }
}

function compareJson(originalData, testData) {
        let showFullResponse = false;
        if (options.config) {
            let configFile;
            try {
                configFile = require(options.config);
                showFullResponse = configFile.showFullResponse || false;
            } catch (error) {
                console.log(error);
                console.error('Error: Invalid JSON in config file.');
                process.exit(1);
            }
            originalData.response = updateResponse(originalData.response, configFile);
            testData.response = updateResponse(testData.response, configFile);
        }
        const differences = diff.diffString(originalData.response, testData.response,{maxElisions:1, full: showFullResponse });
        if (differences && differences!=="" && (differences.includes('-  ')||differences.includes('+  '))){
                console.log(`[${originalData.uuid}] ${originalData.endpoint}`);
                console.log(differences);
        }
}


function getDeepKeys(obj, depth = 0, prefix = '') {
    if (depth > 100) { // adjust the limit as needed
        throw new Error('Maximum recursion depth exceeded');
    }
    return _.flatMap(obj, (value, key) => {
        const newPrefix = prefix ? `${prefix}.${String(key)}` : String(key);
        if (_.isArray(value)) {
            const arrayPaths = _.flatMap(value, (item, index) => getDeepKeys(item, depth + 1, `${newPrefix}[${index}]`));
            return [newPrefix, ...arrayPaths];
        } else if (_.isObject(value)) {
            return [newPrefix, ...getDeepKeys(value, depth + 1, newPrefix)];
        }
        return newPrefix;
    });
}

function updateResponse(response , config) {
    for (let path of getDeepKeys(response,10)) {
        if (config.ignores) {
            for (let ignore of config.ignores) {
                if (minimatch(path, ignore)) {
                    _.unset(response, path);
                    break;
                }
            }
        }

        if (config.toStrings) {
            for (let filter of config.toStrings) {
                if (minimatch(path, filter)) {
                    const original = _.get(response, path);
                    _.set(response, path, original.toString());
                    break;
                }
            }
        }

        if (config.roundNumbers) {
            for (let filter of config.roundNumbers) {
                if (minimatch(path, filter)) {
                    const original = _.get(response, path);
                    _.set(response, path, Math.round(original));
                    break;
                }
            }
        }

        if (config.typeOnly){
            for (let filter of config.typeOnly) {
                if (minimatch(path, filter)) {
                    const original = _.get(response, path);
                    _.set(response, path, typeof original);
                    break;
                }
            }
        }

        if (config.sortsBy){
            for (let sortBy of config.sortsBy) {
                if (minimatch(path, sortBy.path)) {
                    _.set(response, path, _.sortBy(_.get(response, path), sortBy.keys, sortBy.orders));
                    break;
                }
            }
        }

        if (Array.isArray(response.tokens) && response.tokens.length === 0) {
            _.unset(response, 'tokens');
        }

    }
    return response;
}
if (options.mode === 'file') {
    const parseFile = (filePath) => {
        const data = fs.readFileSync(filePath, 'utf-8');
        const regex = /^(\S+)\s+(\S+)\s+\[(\S+)\]\s+(\S+)\s+(.+)$/;
        return data.split('\n').map(line => {
            const match = line.match(regex);
            if (match) {
                const [_, date, time, uuid, endpoint, response] = match;
                return { date, time, uuid, endpoint, response: JSON.parse(response) };
            }
            return null;
        }).filter(entry => entry !== null);
    };
    const originalData = parseFile(options.original);
    const testData = parseFile(options.test);
    const testDataMap = new Map(testData.map(entry => [entry.uuid, entry]));
      originalData.forEach(originalEntry => {
    const testEntry = testDataMap.get(originalEntry.uuid);
    if (!testEntry) {
        console.error(`Error: No matching test entry found for UUID: ${originalEntry.uuid}`);
        return;
    }
    compareJson(originalEntry, testEntry);
  });
}else if (options.mode === 'url') {
    compareResponses(options.original, options.test, options.endpoint, options.method);
}else{
  console.error('Unsupported mode. Only "file" mode is supported.');
  process.exit(1);
}