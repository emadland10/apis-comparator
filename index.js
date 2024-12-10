const { Command } = require('commander');
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
    .requiredOption('-o, --original <url>', 'Original API URL')
    .requiredOption('-t, --test <url>', 'Test API URL')
    .option('-e, --endpoint [endpoint]', 'Endpoint', '')
    .option('-m, --method [method]', 'HTTP method', 'get')
    .option('-r, --retry [retry]', 'Number of retries in case of error', 1)
    .option('-n, --number [number]', 'Number of replays', 1)
    .option('-c, --config <path>', 'Path to config file')
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
         // const startTimeOriginal = Date.now();
    let originalResponse = (await getResponse(originalUrl + endpoint, method));
    // const timeTakenOriginal = Date.now() - startTimeOriginal;
    const testTimeOriginal = Date.now();
    let testResponse = (await getResponse(testUrl + endpoint, method));
    timeTakenTimeTest = Date.now() - testTimeOriginal;
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
    // if (timeTakenTimeTest>timeTakenOriginal) {
    //     console.log(`Original time: ${timeTakenOriginal}ms, Test time: ${timeTakenTimeTest}ms`);
    // }   
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

    }
    return response;
}
compareResponses(options.original, options.test, options.endpoint, options.method);