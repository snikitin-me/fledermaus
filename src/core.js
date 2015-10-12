import path from 'path';
import glob from 'glob';
import fastmatter from 'fastmatter';
import _ from 'lodash';

import {
	getExtension,
	removeExtension,
	readFile,
	writeFile,
	readYamlFile,
	formatFieldsForSortByOrder
} from './util';

/**
 * Convert file path to URL.
 * 
 * @param {String} filepath
 * @return {String}
 */
export function filepathToUrl(filepath) {
	let url = '/' + removeExtension(filepath)
	url = url.replace(/\/index$/, '');
	if (url === '') {
		return '/';
	}
	return url;
}

/**
 * Renders source using appropriate renderer based on file extension.
 * 
 * @param {String} source Source file contents.
 * @param {String} filepath Source file path.
 * @param {Object} renderers {ext: renderFunction}
 * @return {String}
 */
export function renderByType(source, filepath, renderers={}) {
	let extension = getExtension(filepath);
	let render = renderers[extension];
	if (_.isFunction(render)) {
		return render(source);
	}
	return source;
}

/**
 * Return attributes object with parsed custom fields.
 * 
 * @param {Object} attributes
 * @param {Object} fieldParsers  Custom field parsers: {name: parseFunction}
 * @return {Object}
 */
export function parseCustomFields(attributes, fieldParsers) {
	let parsedAttributes = {};
	for (let name in fieldParsers) {
		parsedAttributes[name] = fieldParsers[name](attributes[name]);
	}
	return _.merge({}, attributes, parsedAttributes);
}

/**
 * Parse front matter and render contents.
 * 
 * @param {String} source Source file contents.
 * @param {String} folder Source folder.
 * @param {String} filepath Source file path relative to `folder`.
 * @param {Object} renderers Content renderers: {ext: renderFunction}
 * @param {Object} fieldParsers Custom field parsers: {name: parseFunction}
 * @return {Object} { sourcePath, content, url }
 */
export function parsePage(source, folder, filepath, renderers={}, fieldParsers={}) {
	let { attributes, body } = fastmatter(source);

	attributes = parseCustomFields(attributes, fieldParsers);

	let content = renderByType(body, filepath, renderers);
	let url = filepathToUrl(filepath);

	return _.merge(attributes, {
		sourcePath: filepath,
		content,
		url
	});
}

/**
 * Return list of source files.
 * 
 * @param {String} folder Source folder.
 * @param {Array} types List of file extensions.
 * @return {Array}
 */
export function getSourceFilesList(folder, types) {
	let typesMask = types.join(',');
	let mask = `**/*.{${typesMask}}`;
	return glob.sync(mask, {cwd: folder});
}

/**
 * Load source files from a disk.
 * 
 * @param {String} folder Source folder.
 * @param {Array} types List of file extensions.
 * @param {Object} renderers {ext: renderFunction}
 * @return {Array} [{ sourcePath, content, url }, ...]
 */
export function loadSourceFiles(folder, types, renderers={}) {
	let files = getSourceFilesList(folder, types);
	return files.map((filepath) => {
		let source = readFile(path.join(folder, filepath));
		return parsePage(source, folder, filepath, renderers);
	});
}

/**
 * Return list of config files.
 * 
 * @param {String} folder Configs folder.
 * @return {Array}
 */
export function getConfigFilesList(folder) {
	return glob.sync(path.join(folder, '*.yml'));
}

/**
 * Read config files from a disk.
 * 
 * @param {Array} files Config files list.
 * @return {Object} {default: {...}, langs: {...}}
 */
export function readConfigFiles(files) {
	return files.reduce((configs, filepath) => {
		let name = removeExtension(path.basename(filepath));
		if (name === 'default') {
			configs.default = readYamlFile(filepath);
		}
		else {
			configs.langs[name] = readYamlFile(filepath);
		}
		return configs;
	}, {default: {}, langs: {}});  // @todo use really default config
}

/**
 * Merge default config with language specific configs.
 * 
 * @param {Object} configs
 * @return {Object} {default: {...}} or {langs: {...}}
 */
export function mergeConfigs(configs) {
	let { langs } = configs;
	if (_.isEmpty(langs)) {
		return {
			default: configs.default
		};
	}

	return Object.keys(langs).reduce((merged, lang) => {
		merged[lang] = _.merge({}, configs.default, langs[lang]);
		return merged;
	}, {});
}

/**
 * Load config files from a disk.
 * 
 * @param {String} folder Source folder.
 * @return {Object} {default: {...}} or {langs: {...}}
 */
export function loadConfig(folder) {
	let files = getConfigFilesList(folder);
	let configs = readConfigFiles(files);
	return mergeConfigs(configs);
}

/**
 * Filter documents.
 * 
 * @param {Array} documents Documents.
 * @param {RegExp} regexp Filter regular expression.
 * @param {String} lang Language.
 * @return {Array}
 */
export function filterDocuments(documents, regexp, lang) {
	return documents.filter((document) => {
		if (lang && document.lang !== lang) {
			return false;
		}

		return regexp.test(document.sourcePath);
	});
}

/**
 * Order documents.
 * 
 * @param {Array} documents Documents.
 * @param {Array} fields ['foo', '-bar']
 * @return {Array}
 */
export function orderDocuments(documents, fields) {
	fields = formatFieldsForSortByOrder(fields);
	return _.sortByOrder(documents, ...fields);
}

/**
 * Return URL for given page number.
 * 
 * @param {String} urlPrefix
 * @param {Number} pageNumber
 * @return {String}
 */
export function getPageNumberUrl(urlPrefix, pageNumber) {
	return `${urlPrefix}/page/${pageNumber}`;
}

/**
 * Generate documents to paginate given documents.
 * 
 * @param {Array} documents Documents to paginate
 * @param {String} options.urlPrefix URL prefix.
 * @param {Number} options.documentsPerPage Documents per page.
 * @param {String} options.layout Page layout.
 * @return {Array}
 */
export function generatePagination(documents, { urlPrefix, documentsPerPage, layout } = {}) {
	if (!urlPrefix) {
		throw new Error(`"urlPrefix" not specified for generatePagination().`);
	}
	if (!documentsPerPage) {
		throw new Error(`"documentsPerPage" not specified for generatePagination().`);
	}
	if (!layout) {
		throw new Error(`"layout" not specified for generatePagination().`);
	}

	let totalPages = Math.ceil(documents.length / documentsPerPage);

	return _.range(totalPages).map((pageNumber) => {
		pageNumber++;
		let url = getPageNumberUrl(urlPrefix, pageNumber);
		let begin = (pageNumber - 1) * documentsPerPage;
		return {
			previousUrl: pageNumber > 1 ? getPageNumberUrl(urlPrefix, pageNumber - 1) : null,
			nextUrl: pageNumber < totalPages ? getPageNumberUrl(urlPrefix, pageNumber + 1) : null,
			sourcePath: url.replace(/^\//, ''),
			documents: documents.slice(begin, begin + documentsPerPage),
			layout,
			url
		};
	});
}

/**
 * Create context for page rendering: merges document, config and helpers into one object.
 * 
 * @param {Object} document
 * @param {Object} config
 * @param {Object} helpers
 * @return {Object}
 */
export function makeContext(document, config, helpers) {
	return _.merge({}, helpers, { config }, document);
}

/**
 * Generate page.
 * 
 * @param {Object} document
 * @param {Object} config
 * @param {Object} helpers
 * @param {Object} renderers {extension: renderFunction}
 * @return {Object} { pagePath, content }
 */
export function generatePage(document, config, helpers, renderers) {
	if (!document.layout) {
		throw new Error(`Layout not specified for ${document.sourcePath}. Add "layout" front matter field.`);
	}

	let [ templateExtension, render ] = _.pairs(renderers).shift();
	let templateFile = `${document.layout}.${templateExtension}`;

	let context = makeContext(document, config, helpers);
	let content = render(templateFile, context);

	return {
		pagePath: removeExtension(document.sourcePath),
		content
	};
}

/**
 * Generate pages.
 * 
 * @param {Array} documents
 * @param {Object} config
 * @param {Object} helpers
 * @param {Object} renderers {extension: renderFunction}
 * @return {Array} [{ pagePath, content }, ...]
 */
export function generatePages(documents, config, helpers, renderers) {
	return documents.map(document => generatePage(document, config, helpers, renderers));
}

/**
 * Saves page to a disk.
 * 
 * @param {Object} page
 * @param {String} folder Folder to save files.
 */
export function savePage(page, folder) {
	writeFile(path.join(folder, `${page.pagePath}.html`), page.content);
}

/**
 * Saves pages to a disk.
 * 
 * @param {Array} pages
 * @param {String} folder Folder to save files.
 */
export function savePages(pages, folder) {
	return pages.map(page => savePage(page, folder));
}
