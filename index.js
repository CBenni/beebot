var express = require("express");
var request = require("request");
var Discord = require('discord.js');

const Canvas = require("canvas");
const Image = Canvas.Image;

const twemoji = require("./twemoji");

var app = express()
var config = require("./config");

var cache = {};

templates = {
	bee: {
		template: "./BeeTemplate.png",
		leftOffset: 475,
		widthTarget: 600,
		bottomTarget: 530
	},
	turtle: {
		template: "./TurtleTemplate.png",
		leftOffset: 210,
		widthTarget: 150,
		bottomTarget: 150
	}
}

for(templateName in templates) {
	const data = templates[templateName];
	data.image = new Image();
	data.image.src = data.template;
}


function render(template, img, size) {
	var width = img.width;
	var height = img.height;
	if (size && size.height) {
		height = size.height;
		if (!size.width) width = width * size.height / img.height;
	}
	if (size && size.width) {
		width = size.width;
		if (!size.height) height = height * size.width / img.width;
	}

	const templateScale = width / template.widthTarget; // scale the template to fit the image


	let resultingWidth = template.image.width * templateScale;
	let resultingHeight = template.image.height * templateScale;

	let imgTop = template.bottomTarget * templateScale - height; // naive top center position

	if (imgTop < 0) {
		resultingHeight -= imgTop;
		imgTop = 0;
	}

	const resultingImgTop = imgTop;
	const resultingImgLeft = template.leftOffset * templateScale - width / 2.0;

	if(resultingImgLeft + width > resultingWidth) {
		resultingWidth = resultingImgLeft + width;
	}

	const resultingTemplateTop = resultingHeight - template.image.height * templateScale;
	const resultingTemplateLeft = 0.0;

	var canvas = new Canvas(resultingWidth, resultingHeight);
	var ctx = canvas.getContext("2d");
	console.log("Drawing template "+template.template)
	try {
		ctx.drawImage(template.image, resultingTemplateLeft, resultingTemplateTop, template.image.width * templateScale, template.image.height * templateScale);
		console.log("Drawing done.")
	} catch (err) {
		throw new Error(JSON.stringify({ status: 400, error: "Invalid template" }))
	}
	console.log("Drawing image")
	try {
		ctx.drawImage(img, resultingImgLeft, resultingImgTop, width, height);
		console.log("Drawing done.")
	} catch (err) {
		console.error(err);
		throw new Error(JSON.stringify({ status: 400, error: "Invalid image" }))
	}

	// return the image and cache it 
	return(canvas);
}

const circleScale = 0.4;
const lineWidthScale = 0.2;
const lowerRightFactor = 0.5 + 0.7071 * circleScale; // %-ual location of the lower right end of the strikethrough line
const upperLeftFactor = 0.5 - 0.7071 * circleScale; // %-ual location of the upper left end of the strikethrough line

app.get("/:templateName/", async function (req, res) {
	if(!templates[req.params.templateName]) return res.status(404).end();
	try {
		const canvas = render(templates[req.params.templateName], await loadImage(req.query.url))
		console.log(canvas)
		res.setHeader('Content-Type', 'image/png');
		return canvas.pngStream().pipe(res);
	} catch(err) {
		console.log(err.message);
		return res.status(400).end(err.message);
	}
});

app.listen(3002, function () {
	console.log('Beebot app listening on port 3002!')
})



// Discord stuff


var client = new Discord.Client({
	autoReconnect: true
});
// manage roles permission is required
const invitelink = 'https://discordapp.com/oauth2/authorize?client_id='
	+ config.discord.client_id + '&scope=bot&permissions=0';
const authlink = 'https://discordapp.com/oauth2/authorize?client_id='
	+ config.discord.client_id + '&scope=email';
console.log("Bot invite link: " + invitelink);

client.login(config.discord.token).catch(function (error) {
	if (error) {
		console.error("Couldn't login: ", error);
		process.exit(15);
	}
});


function findEmoji(str) {
	const discordEmote = /<:(\w+):(\d+)>/g.exec(str)
	if (discordEmote) {
		return {
			name: discordEmote[1],
			id: discordEmote[2],
			url: `https://cdn.discordapp.com/emojis/${discordEmote[2]}.png`
		}
	}

	let unicodeEmoji;
	twemoji.parse(str, (name, emoji) => {
		if (unicodeEmoji) return false;
		unicodeEmoji = {
			name,
			id: name,
			url: emoji.base + emoji.size + "/" + name + emoji.ext
		}
		return false;
	});
	return unicodeEmoji;
}

function loadImage(url) {
	return new Promise((resolve, reject) => {
		console.log("Getting " + url);
		if (url) {
			request.get({ url: url, encoding: null }, function (e, r, data) {
				if (e) {
					return reject({ status: (r && r.statusCode || 500), error: e });
				}
				var img = new Image();
				img.src = data;
				resolve(img);
			})
		}
	});
}

client.on('message', async function (message) {
	console.log(message.cleanContent);

	const messageSplit = message.cleanContent.split(" ");
	const emoji = findEmoji(message.cleanContent);
	let result = null;
	let count = 0;
	try {
		if (emoji) {
			let name = emoji.name;
			for (var i = 0; i < messageSplit.length && count < 4; ++i) {
				const commandParsed = /^\/(\w+)\b/.exec(messageSplit[i]);
				if (commandParsed && templates[commandParsed[1]]) {
					count++;
					name += commandParsed[1];
					if (result === null) result = await loadImage(emoji.url);
					result = render(templates[commandParsed[1]], result);
				} else {
					if(i===0) return;
				}
			}
			if (result) {
				var messageOptions = {
					files: [
						{ attachment: result.toBuffer(), name: name + ".png" }
					]
				}
				message.channel.send("", messageOptions);
			}
		}
	} catch(err) {
		console.error(err);
	}
});