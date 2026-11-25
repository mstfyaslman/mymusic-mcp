from mcp.server.fastmcp import FastMCP

mcp = FastMCP("mymusic")

@mcp.tool()
def hello(name: str) -> str:
    return f"Hello {name} from MyMusic!"

if __name__ == "__main__":
    mcp.run()
