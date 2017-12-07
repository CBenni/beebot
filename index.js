var express = require("express");
var request = require("request");
var Discord = require('discord.js');

const Canvas = require("canvas");
const Image = Canvas.Image; 

const twemoji = require("./twemoji");

var app = express()
var config = require("./config");

var cache = {};

const beeTemplate = new Image();
beeTemplate.src = "./BeeTemplate.png";


function bee(url, size) {
	return new Promise((resolve,reject)=>{
		console.log("Getting "+url);
		if(url) {
			request.get({url:url, encoding: null}, function(e, r, data) {
				if(e) {
					reject({status: (r && r.statusCode || 500), error: e});
					return;					
				}
				var img = new Image();
				img.src = data;
				console.log("image loaded");
				var width = img.width;
				var height = img.height;
				if(size && size.height) {
					height = size.height;
					if(!size.width) width = width * size.height / img.height;
				}
				if(size && size.width) {
					width = size.width;
					if(!size.height) height = height * size.width / img.width;
				}

				const leftOffset = 475.0; // relative to bee template width
				const widthTarget = 600.0; // relative to bee template width
				const bottomTarget = 530; // relative to bee template height

				const beeScale = width / widthTarget; // scale the bee to fit the image

				
				const resultingWidth = beeTemplate.width * beeScale;
				let resultingHeight = beeTemplate.height * beeScale;

				let imgTop = bottomTarget * beeScale - height; // naive top center position

				if(imgTop < 0) {
					resultingHeight -= imgTop;
					imgTop = 0;
				}

				const resultingImgTop = imgTop;
				const resultingImgLeft = leftOffset * beeScale - width / 2.0;

				const resultingBeeTop = resultingHeight - beeTemplate.height * beeScale;
				const resultingBeeLeft = 0.0;

				var canvas = new Canvas(resultingWidth, resultingHeight);
				var ctx = canvas.getContext("2d");
				console.log("Drawing first image")
				try {
					ctx.drawImage(beeTemplate, resultingBeeLeft, resultingBeeTop, resultingWidth, beeTemplate.height * beeScale);
				} catch(err) {
					reject({status: 400, error: "Invalid template"})
				}
				console.log("Drawing second image")
				try {
					ctx.drawImage(img, resultingImgLeft, resultingImgTop, width, height);
				} catch(err) {
					reject({status: 400, error: "Invalid image"})
				}
				console.log("Drawing done.")
				
				// return the image and cache it 
				resolve(canvas);
			});
		} else {
			reject({status: 400, error: "No url specified"});
		}
	});
}

const circleScale = 0.4;
const lineWidthScale = 0.2;
const lowerRightFactor = 0.5 + 0.7071*circleScale; // %-ual location of the lower right end of the strikethrough line
const upperLeftFactor = 0.5 - 0.7071*circleScale; // %-ual location of the upper left end of the strikethrough line

app.get("/bee/", function(req, res) {
	bee(req.query.url).then((canvas)=>{
		console.log(canvas)
		res.setHeader('Content-Type', 'image/png');
		canvas.pngStream().pipe(res);
	}).catch((err)=>{
		res.status(err.status).end(err.error);
	})
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
console.log("Bot invite link: "+invitelink);

client.login(config.discord.token).catch(function (error) {
    if (error) {
        console.error("Couldn't login: ", error);
        process.exit(15);
    }
});


function findEmoji(str) {
	const discordEmote = /<:(\w+):(\d+)>/g.exec(str)
	if(discordEmote) {
		return {
			name: discordEmote[1],
			id: discordEmote[2],
			url: `https://cdn.discordapp.com/emojis/${discordEmote[2]}.png`
		}
	}

	let unicodeEmoji;
	twemoji.parse(str, (name, emoji) =>{
		if(unicodeEmoji) return false;
		unicodeEmoji = {
			name, 
			id: name,
			url: emoji.base + emoji.size + "/" + name + emoji.ext
		}
		return false;
	});
	return unicodeEmoji;
}

client.on('message', function (message) {
	console.log(message.cleanContent);
    if (message.cleanContent.startsWith("/bee")) {
			// get emoji from message
			const emoji = findEmoji(message.cleanContent);
			if(emoji) bee(emoji.url).then(canvas => {
				var messageOptions = {
					files: [
						{attachment: canvas.toBuffer(), name: emoji.name.toUpperCase()+"DETECTED.png"}
					]
				}
				message.channel.send("", messageOptions);
			});
    }
});