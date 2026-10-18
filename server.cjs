const http=require("node:http");
const fs=require("node:fs");
const path=require("node:path");
const root=__dirname;
const port=Number(process.env.PORT)||4186;
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8"};
const allowed=new Set(["index.html","app.js","styles.css","questions.json"]);
const server=http.createServer((req,res)=>{
  if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405);res.end();return;}
  let name;
  try{name=new URL(req.url,"http://127.0.0.1").pathname.slice(1)||"index.html";}catch{res.writeHead(400);res.end();return;}
  if(!allowed.has(name)){res.writeHead(404);res.end("Not found");return;}
  fs.readFile(path.join(root,name),(err,data)=>{
    if(err){res.writeHead(500);res.end("File could not be read");return;}
    res.writeHead(200,{"Content-Type":types[path.extname(name)],"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Length":data.length});
    res.end(req.method==="HEAD"?undefined:data);
  });
});
server.on("error",e=>{console.error(e.code==="EADDRINUSE"?"Port 4186 is already in use. Set PORT to choose another port.":e);process.exit(1);});
server.listen(port,"127.0.0.1",()=>console.log("Local: http://127.0.0.1:"+port));
