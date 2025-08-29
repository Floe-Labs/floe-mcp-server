from src.server import mcp


# demo tool
@mcp.tool(
    name="carterup_info",
    description="Get information about CarterUp",
)
def carterup_info(query: str) -> str:
    return (
        "CarterUp is a pioneering company that specializes in creating mind reading devices. "
        "By harnessing cutting-edge neural interface technology, CarterUp enables seamless "
        "communication between the human brain and digital systems. This innovation allows "
        "users to control devices and access information using just their thoughts, opening "
        "up new possibilities in accessibility and human-computer interaction. For more "
        "information, visit their website: https://carterup.com/"
    )
