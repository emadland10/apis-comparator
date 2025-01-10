const { Command } = require('commander');
const fs = require('fs');
const { minimatch } = require('minimatch')
const micromatch = require('micromatch');
const program = new Command();
const axios = require('axios');
const _ = require('lodash');
const diff = require('jest-diff');
const allowedErrorsPercent = process.env.ALLOWED_ERRORS_PERCENT || 0;


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
        if (!_.isEqual(originalResponse, testResponse)) {
            if (retryCount < options.retry) {
                console.log(`Retrying ${retryCount + 1} time`);
                return compareResponses(originalUrl, testUrl, endpoint, method, retryCount + 1);
            } else {
                const differences = diff.diff(originalResponse, testResponse, { expand: showFullResponse  }).split('\n').slice(2).join('\n');
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
    if (!_.isEqual(originalData.response, testData.response)) {
        const differences = diff.diff(originalData.response, testData.response, { expand: showFullResponse }).split('\n').slice(2).join('\n');
        console.log(`[${originalData.uuid}] ${originalData.endpoint}`);
        console.log(differences);
        return false;
    }else{
        return true;
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
    let errorsCount = 0;
    const parseFile = (filePath) => {
        const data = fs.readFileSync(filePath, 'utf-8');
        const regex = /^(\S+)\s+(\S+)\s+\[(\S+)\]\s+(\S+)\s+(\S+)\s+(.+)$/;
        return data.split('\n').map(line => {
            const match = line.match(regex);
            if (match) {
                const [_, date, time, uuid, method, endpoint, response] = match;
                return { date, time, uuid, method, endpoint, response: JSON.parse(response) };
            }
            return null;
        }).filter(entry => entry !== null);
    };
    const originalData = parseFile(options.original);
    console.log(`Original data: ${originalData.length} entries`);
    const testData = parseFile(options.test);
    console.log(`Test data: ${testData.length} entries`);
    const testDataMap = new Map(testData.map(entry => [entry.uuid, entry]));
      originalData.forEach(originalEntry => {
    const testEntry = testDataMap.get(originalEntry.uuid);
    if (!testEntry) {
        console.error(`Error: No matching test entry found for UUID: ${originalEntry.uuid}`);
        return;
    }
    errorsCount += !compareObjects(originalEntry, testEntry);
  });
    const errorPercent = (errorsCount / originalData.length) * 100;
    if (errorPercent > allowedErrorsPercent) {
        console.error(`Error: Number of errors ${errorsCount} exceeded the allowed percent ${allowedErrorsPercent}% in ${originalData.length} entries`);
        process.exit(1);
    }else{
        console.log(`Number of errors ${errorsCount} in ${originalData.length} entries`);
    }
}else if (options.mode === 'url') {
    compareResponses(options.original, options.test, options.endpoint, options.method);
}else{
  console.error('Unsupported mode. Only "file" mode is supported.');
  process.exit(1);
}

function compareObjects(obj1, obj2) {
    const config = require(options.config);
    const { ignores, sorts, typeOnly, toStrings, sortsBy, allowance, allowancePercent, beautifyDiff } = config;
    const differences = [];
    const stats = { totalDifferences: 0, fields: {} };

    function shouldIgnore(path) {
        return micromatch.isMatch(path, ignores);
    }

    function sortArrays(obj, paths) {
        paths.forEach(path => {
            const array = _.get(obj, path);
            if (Array.isArray(array)) {
                array.sort();
            }
        });
    }

    function sortByKeys(obj, sortsBy) {
        sortsBy.forEach(sortConfig => {
            const array = _.get(obj, sortConfig.path);
            if (Array.isArray(array)) {
                array.sort((a, b) => {
                    for (let i = 0; i < sortConfig.keys.length; i++) {
                        const key = sortConfig.keys[i];
                        const order = sortConfig.orders[i] === 'asc' ? 1 : -1;
                        if (_.get(a, key) < _.get(b, key)) return -order;
                        if (_.get(a, key) > _.get(b, key)) return order;
                    }
                    return 0;
                });
            }
        });
    }

    function compareValues(path, original, test) {
        if (shouldIgnore(path)) return;

        if (typeOnly.includes(path)) {
            if (typeof original !== typeof test) {
                differences.push({ path, original, test });
                stats.totalDifferences++;
                stats.fields[path] = (stats.fields[path] || 0) + 1;
            }
            return;
        }

        if (toStrings.includes(path)) {
            original = String(original);
            test = String(test);
        }

        if (allowance.some(allow => micromatch.isMatch(path, allow.path))) {
            const allowedDiff = allowance.find(allow => micromatch.isMatch(path, allow.path)).value;
            if (Math.abs(original - test) > allowedDiff) {
                differences.push({ path, original, test });
                stats.totalDifferences++;
                stats.fields[path] = (stats.fields[path] || 0) + 1;
            }
            return;
        }

        const allowancePercentConfig = allowancePercent.find(allow => micromatch.isMatch(path, allow.path));
        if (allowancePercentConfig) {
            const allowedDiff = (allowancePercentConfig.percent / 100) * Math.max(Math.abs(original), Math.abs(test));
            if (Math.abs(original - test) > allowedDiff) {
                differences.push({ path, original, test });
                stats.totalDifferences++;
                stats.fields[path] = (stats.fields[path] || 0) + 1;
            }
            return;
        }

        if (path.endsWith('symbol') && original === '' && !test) {
            return;
        }

        if (original !== test) {
            differences.push({ path, original, test });
            stats.totalDifferences++;
            stats.fields[path] = (stats.fields[path] || 0) + 1;
        }
    }

    function traverse(obj1, obj2, path = '') {
        if (obj1.error && obj1.error === 'non-json response from backend') {
            return true;
        }
        if (obj2.error && obj2.error.message && obj2.error.message === 'Invalid timestamp') {
            return true;
        }
        if (path.includes("/getTokenHistory?apiKey")){
            return true;
        }
        if (Array.isArray(obj1.tokens) && obj1.tokens.length === 0) {
            _.unset(obj1, 'tokens');
        }
        if (Array.isArray(obj2.tokens) && obj2.tokens.length === 0) {
            _.unset(obj2, 'tokens');
        }
        if (Array.isArray(obj1) && obj1.length === 0) {
            _.unset(obj1, path);
        }
        if (Array.isArray(obj2) && obj2.length === 0) {
            _.unset(obj2, path);
        }

        const keys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);
        keys.forEach(key => {
            const newPath = path ? `${path}.${key}` : key;
            if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
                traverse(obj1[key], obj2[key], newPath);
            } else {
                compareValues(newPath, obj1[key], obj2[key]);
            }
        });
    }
    if (obj1.method !== 'GET') {
        return true;
    }
    sortArrays(obj1.response, sorts);
    sortArrays(obj2.response, sorts);
    sortByKeys(obj1.response, sortsBy);
    sortByKeys(obj2.response, sortsBy);
    traverse(obj1.response, obj2.response);

    if (stats.totalDifferences !== 0) {
        if (beautifyDiff){
            compareJson(obj1, obj2);    
        }
        console.log(differences);
        return false
    }else{
        return true;
    }
}