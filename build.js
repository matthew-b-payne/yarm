#!/usr/bin/env node

/*jshint node:true */
"use strict";

var fs = require("fs");
var spawn = require("child_process").spawn;


var BRANCH = "master";
var TOC_HEADER = "Table of contents";
var TOC_DEPTH = 3;
var DOC_PREFIX = "doc-";


function gitFetch(file, cb) {
	var content = "";
	var git = spawn("git", ["show", BRANCH + ":" + file]);

	git.stdout.on("data", function(chunk) {
		content += chunk.toString();
	});

	git.stdout.on("end", function() {
		cb(content);
	});
}

var fetchJobs = {
	"doc": gitFetch.bind(null, "USAGE.md"),
	"changelog": gitFetch.bind(null, "CHANGELOG"),
	"version": function(cb) {
		gitFetch("package.json", function(json) {
			cb(JSON.parse(json).version);
		});
	}
};


// Split markdown data recursively at headers from level to maxLevel
function splitSections(level, maxLevel, data) {
	var regexp = "^";
	for (var i = 0; i < level; i++) regexp += "#";
	regexp += " (.*)$";

	var sections = {};
	var curSection = "_";
	data.split(new RegExp(regexp, "m")).forEach(function(text, index) {
		if (index % 2 === 0) {
			if (level < maxLevel) {
				var subs = splitSections(level + 1, maxLevel, text);

				if (typeof subs === "string" || Object.keys(subs).length > 0)
					sections[curSection] = subs;
			} else {
				text = text.replace(/(^\n+|\n+$)/g, "");
				if (text.length > 0) {
					sections[curSection] = text;
				}
			}
		} else {
			curSection = text;
		}
	});

	if (Object.keys(sections).length === 1) {
		return sections._;
	} else {
		return sections;
	}
}


function joinSections(data, level) {
	level = level || 1;
	var sharps = "";
	for (var i = 0; i < level; i++) sharps += "#";

	if (typeof data === "string") {
		return data;
	} else {
		return Object.keys(data).map(function(header) {
			if (header === "_") {
				return joinSections(data._, level + 1) + "\n\n";
			} else {
				return "<a name=\"" + sectionName(header) + "\"></a>\n" +
					sharps + " " + header + "\n\n" + joinSections(data[header], level + 1) + "\n\n";
			}
		}).join("\n");
	}
}


function getTOC(data, slinks, depth, page) {
	if (typeof data === "string" || depth === TOC_DEPTH) return "";

	return "<ul class=\"level" + depth + "\">\n" +
		Object.keys(data).map(function(header) {
			if (header === "_") return "";

			var name = sectionName(header);

			var link = page ? DOC_PREFIX + page + ".html#" + name : DOC_PREFIX + name + ".html";
			slinks[sectionName(header)] = link;

			var pageClass = depth === 0 ? "{% if page.id == 'doc-" + name + "' %}active{% endif %}" : "";

			return "<li class=\"" + pageClass + "\"><a href=\"" + link + "\">" + header + "</a>\n" +
				getTOC(data[header], slinks, depth + 1, page || name) + "\n" +
				"</li>";
		}).join("\n") +
		"</ul>\n";
}


function sectionName(header) {
	return header.toLowerCase().replace(/ /g, "-").replace(/[^a-z-]/g, "");
}


function generate(data) {
	var doc = data.doc;

	// Extract and remove link references
	var links = doc.match(/^(\[.*\]: .*)$/gm);
	doc = doc.replace(/^\[.*\]: .*$/gm, "");

	// Split at headers to get a section tree
	var sections = splitSections(2, 6, doc);

	// Remove TOC and anything before first header
	delete sections._;
	delete sections[TOC_HEADER];

	// Generate TOC and section links
	var slinks = {};
	fs.writeFileSync(__dirname + "/_includes/" + DOC_PREFIX + "toc.html", getTOC(sections, slinks, 0).replace(/\n+/g, "\n"));

	// Write version file
	fs.writeFileSync(__dirname + "/_includes/version", data.version);

	// Write date file
	fs.writeFileSync(__dirname + "/_includes/gendate", new Date());

	// Write changelog
	fs.writeFileSync(__dirname + "/_includes/changelog.markdown",
		data.changelog.replace(/^(NEXT|version [0-9.]+)(?: - ([0-9-]+))?$/gm, function(m, section, date) {
			return "**" + section + "**" + (date ? " *released on " + date + "*" : "") + "\n";
		})
	);

	// Write section files
	Object.keys(sections).forEach(function(header) {
		// Generate markdown
		var markdown = joinSections(sections[header], 2)

			// Replace code tags
			.replace(/```javascript([^`]*)```/gm, function(m, code) {
				return "{% highlight javascript %}" + code + "{% endhighlight %}";
			})
			.replace(/```\n([^`]*)```/gm, function(m, shell) {
				return "<div class=\"highlight\"><pre><code>" +
					shell.replace(/^\$ (.*)$/gm, function(m, cmd) {
						return "<span class=\"p\">$ " + cmd + "</span>";
					}) +
					"</code></pre></div>";
			})


			// Replace section links
			.replace(/\[([^\]]+)\]\(#([a-z-]+)\)/g, function(m, caption, href) {
				return "[" + caption + "](" + slinks[href] + ")";
			});

		markdown += "\n\n<div class=\"footer\">" +
			"documentation last generated for yarm version {% include version %} on {% include gendate %}" +
			"</div>";

		fs.writeFileSync(__dirname + "/" + DOC_PREFIX + sectionName(header) + ".markdown",
			"---\n" +
			"layout: default\n" +
			"title: yarm - " + header + "\n" +
			"id: doc-" + sectionName(header) + "\n" +
			"---\n" +
			"# " + header + "\n\n" +
			markdown + "\n\n" +
			links.join("\n")
		);
	});
}


function run() {
	// Run fetch jobs
	var fetched = {};

	Object.keys(fetchJobs).forEach(function(key) {
		fetchJobs[key](function(data) {
			fetched[key] = data;

			if (Object.keys(fetchJobs).length === Object.keys(fetched).length) {
				// Done
				generate(fetched);
			}
		});
	});
}


run();