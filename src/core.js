import path from 'path';
import glob from 'glob';
import fastmatter from 'fastmatter';
import _ from 'lodash';

import renderRss from './renderers/rss';
import {
	getExtension,
	removeExtension,
	readFile,
	writeFile,
	readYamlFile,
	formatFieldsForSortByOrder,
} from './util';

/**
 * Convert file path to URL.
 *
 * @param {string} filepath
 * @return {string}
 */
export function filepathToUrl(filepath) {
	let url = '/' + removeExtension(filepath);
	url = url.replace(/\/index$/, '');
	if (url === '') {
		return '/';
	}
	return url;
}

/**
 * Renders source using appropriate renderer based on file extension.
 *
 * @param {string} source Source file contents.
 * @param {string} filepath Source file path.
 * @param {object} renderers {ext: renderFunction}
 * @return {string}
 */
export function renderByType(source, filepath, renderers = {}) {
	const extension = getExtension(filepath);
	const render = renderers[extension];
	if (_.isFunction(render)) {
		return render(source);
	}
	return source;
}

/**
 * Return attributes object with parsed custom fields.
 *
 * @param {object} attributes
 * @param {object} fieldParsers  Custom field parsers: {name: parseFunction}
 * @return {object}
 */
export function parseCustomFields(attributes, fieldParsers) {
	const parsedAttributes = {};
	for (const name in fieldParsers) {
		parsedAttributes[name] = fieldParsers[name](attributes[name], attributes);
	}
	return {
		...attributes,
		...parsedAttributes,
	};
}

/**
 * Parse front matter and render contents.
 *
 * @param {string} source Source file contents.
 * @param {string} filepath Source file path relative to `folder`.
 * @param {object} $2.renderers Content renderers: {ext: renderFunction}.
 * @param {object} $2.fieldParsers Custom field parsers: {name: parseFunction}.
 * @param {object} $2.cutTag Cut separator.
 * @return {object} { sourcePath, content, excerpt, more, url }
 */
export function parsePage(source, filepath, { renderers = {}, fieldParsers = {}, cutTag } = {}) {
	const { attributes, body } = fastmatter(source);

	const url = filepathToUrl(filepath);

	const content = renderByType(body, filepath, renderers);

	let excerpt;
	let more;
	if (cutTag) {
		[excerpt, more] = content.split(cutTag);
	}

	const extendedAttributes = {
		...attributes,
		sourcePath: filepath,
		content: content && content.trim(),
		excerpt: excerpt && excerpt.trim(),
		more: more && more.trim(),
		url,
	};

	return parseCustomFields(extendedAttributes, fieldParsers);
}

/**
 * Return list of source files.
 *
 * @param {string} folder Source folder.
 * @param {Array} types List of file extensions.
 * @return {Array}
 */
export function getSourceFilesList(folder, types) {
	const typesMask = types.length > 1 ? `{${types.join(',')}}` : types[0];
	const mask = '**/*.' + typesMask;
	return glob.sync(mask, { cwd: folder });
}

/**
 * Load source files from a disk.
 *
 * @param {string} folder Source folder.
 * @param {Array} types List of file extensions.
 * @param {object} options { renderers, fieldParsers, cutTag }
 * @return {Array} [{ sourcePath, content, url }, ...]
 */
export function loadSourceFiles(folder, types, options) {
	const files = getSourceFilesList(folder, types);
	if (!files.length) {
		/* eslint-disable no-console */
		console.warn(`No source files found in a folder ${path.resolve(folder)} with types ${types.join(', ')}`);
		/* eslint-enable no-console */
	}
	return files.map((filepath) => {
		const source = readFile(path.join(folder, filepath));
		return parsePage(source, filepath, options);
	});
}

/**
 * Return list of config files.
 *
 * @param {string} folder Configs folder.
 * @return {Array}
 */
export function getConfigFilesList(folder) {
	return glob.sync(path.join(folder, '*.yml'));
}

/**
 * Read config files from a disk.
 *
 * @param {Array} files Config files list.
 * @return {object} {base: {...}, langs: {...}}
 */
export function readConfigFiles(files) {
	return files.reduce((configs, filepath) => {
		const name = removeExtension(path.basename(filepath));
		if (name === 'base') {
			configs.base = readYamlFile(filepath);
		}
		else {
			configs.langs[name] = readYamlFile(filepath);
		}
		return configs;
	}, {
		base: {},
		langs: {},
	});
}

/**
 * Merge base config with language specific configs.
 *
 * @param {object} configs
 * @return {object} {base: {...}} or {langs: {...}}
 */
export function mergeConfigs(configs) {
	const { base, langs } = configs;
	const baseConfig = {
		base,
	};

	if (_.isEmpty(langs)) {
		return baseConfig;
	}

	return Object.keys(langs).reduce((merged, lang) => {
		merged[lang] = {
			...configs.base,
			...langs[lang],
		};
		return merged;
	}, baseConfig);
}

/**
 * Load config files from a disk.
 *
 * @param {string} folder Source folder.
 * @return {object} {base: {...}} or {langs: {...}}
 */
export function loadConfig(folder) {
	const files = getConfigFilesList(folder);
	const configs = readConfigFiles(files);
	return mergeConfigs(configs);
}

/**
 * Filter documents by any field (or multiple fields) using a string, function or RegExp.
 *
 * @param {Array} documents Documents.
 * @param {object} fields Filters by field: {lang: 'en', url: /^posts\//, foo: val => val > 5}/
 * @return {Array}
 */
export function filterDocuments(documents, fields) {
	return documents.filter((document) => {
		for (const field in fields) {
			const value = fields[field];
			const documentValue = document[field];
			if (_.isFunction(value)) {
				if (!value(documentValue)) {
					return false;
				}
			}
			else if (_.isRegExp(value)) {
				if (!value.test(documentValue)) {
					return false;
				}
			}
			else if (documentValue !== value) {
				return false;
			}
		}
		return true;
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
	return _.orderBy(documents, ...fields);
}

/**
 * Group documents by values of a given field.
 *
 * @param {Array} documents Documents.
 * @param {String|Function} field Field name or function.
 * @return {object} {fieldValue1: [...], fieldValue2: [...], ...}
 */
export function groupDocuments(documents, field) {
	return documents.reduce((grouped, document) => {
		let value = document[field];
		if (Array.isArray(value)) {
			value.forEach((subValue) => {
				if (!grouped[subValue]) {
					grouped[subValue] = [];
				}
				grouped[subValue].push(document);
			});
		}
		else {
			if (_.isFunction(field)) {
				value = field(document);
			}
			if (!value) {
				return grouped;
			}
			if (!grouped[value]) {
				grouped[value] = [];
			}
			grouped[value].push(document);
		}
		return grouped;
	}, {});
}

/**
 * Return URL for given page number.
 *
 * @param {string} urlPrefix
 * @param {number} pageNumber
 * @param {boolean} $2.index First page will be `index` if true.
 * @return {string}
 */
export function getPageNumberUrl(urlPrefix, pageNumber, { index } = {}) {
	let url;
	if (pageNumber === 1) {
		if (index) {
			url = `${urlPrefix}/index`;
		}
		else {
			url = urlPrefix;
		}
	}
	else {
		url = `${urlPrefix}/page/${pageNumber}`;
	}
	return url.replace(/\/\//, '/');
}

/**
 * Generate documents to paginate given documents.
 *
 * @param {Array} documents Documents to paginate
 * @param {string} $1.sourcePathPrefix Source path prefix.
 * @param {string} $1.urlPrefix URL prefix.
 * @param {number} $1.documentsPerPage Documents per page.
 * @param {string} $1.layout Page layout.
 * @param {boolean} $1.index Add `index` to the first page’s source path.
 * @param {object} $1.extra Extra document options.
 * @return {Array}
 */
export function paginate(documents, { sourcePathPrefix, urlPrefix, documentsPerPage, layout, index, extra = {} } = {}) {
	if (sourcePathPrefix === undefined) {
		throw new Error('"sourcePathPrefix" not specified for paginate().');
	}
	if (urlPrefix === undefined) {
		throw new Error('"urlPrefix" not specified for paginate().');
	}
	if (!documentsPerPage) {
		throw new Error('"documentsPerPage" not specified for paginate().');
	}
	if (!layout) {
		throw new Error('"layout" not specified for paginate().');
	}

	const totalPages = Math.ceil(documents.length / documentsPerPage);

	return _.range(totalPages).map((pageNumber) => {
		pageNumber++;
		const sourcePath = getPageNumberUrl(sourcePathPrefix, pageNumber, { index });
		const url = getPageNumberUrl(urlPrefix, pageNumber);
		const begin = (pageNumber - 1) * documentsPerPage;
		return {
			...extra,
			previousUrl: pageNumber > 1 ? getPageNumberUrl(urlPrefix, pageNumber - 1) : null,
			nextUrl: pageNumber < totalPages ? getPageNumberUrl(urlPrefix, pageNumber + 1) : null,
			documents: documents.slice(begin, begin + documentsPerPage),
			documentsTotal: documents.length,
			sourcePath,
			layout,
			url,
		};
	});
}

/**
 * Create context for page rendering: merges document, config and helpers into one object.
 *
 * @param {object} document
 * @param {object} config
 * @param {object} helpers
 * @return {object}
 */
export function makeContext(document, config, helpers) {
	const context = {
		config,
		...document,
	};

	// Bind helpers to context
	Object.keys(helpers).forEach(name => {
		context[name] = helpers[name].bind(context);
	});

	return context;
}

/**
 * Generate page.
 *
 * @param {object} document
 * @param {object} config
 * @param {object} helpers
 * @param {object} renderers {extension: renderFunction}
 * @return {object} { pagePath, content }
 */
export function generatePage(document, config, helpers, renderers) {
	if (!document.sourcePath) {
		throw new Error('Source path not specified. Add "sourcePath" front matter field.');
	}
	if (!document.layout) {
		throw new Error(`Layout not specified for ${document.sourcePath}. Add "layout" front matter field.`);
	}

	const pagePath = removeExtension(document.sourcePath);
	const pageContext = makeContext(document, config, helpers);

	if (document.layout === 'RSS') {
		return {
			pagePath: `${pagePath}.xml`,
			content: renderRss(pageContext),
		};
	}

	const [templateExtension, render] = _.toPairs(renderers).shift();
	const templateFile = `${document.layout}.${templateExtension}`;
	const content = render(templateFile, pageContext);

	const pageExtension = getExtension(document.layout) || 'html';

	return {
		pagePath: `${pagePath}.${pageExtension}`,
		content,
	};
}

/**
 * Generate pages.
 *
 * @param {Array} documents
 * @param {object} config
 * @param {object} helpers
 * @param {object} renderers {extension: renderFunction}
 * @return {Array} [{ pagePath, content }, ...]
 */
export function generatePages(documents, config, helpers, renderers) {
	return documents.map(document => generatePage(document, config, helpers, renderers));
}

/**
 * Saves page to a disk.
 *
 * @param {object} page
 * @param {string} folder Folder to save files.
 */
export function savePage(page, folder) {
	writeFile(path.join(folder, page.pagePath), page.content);
}

/**
 * Saves pages to a disk.
 *
 * @param {Array} pages
 * @param {string} folder Folder to save files.
 */
export function savePages(pages, folder) {
	pages.forEach(page => savePage(page, folder));
}
