import "@typespec/http";
import "@typespec/openapi3";

using TypeSpec.Http;

@service(#{ title: "Pet Store" })
namespace PetStore;

model Pet {
  id: int32;
  name: string;
  tag?: string;
}

@route("/pets")
namespace Pets {
  @get op list(): Pet[];

  @get op read(@path id: int32): Pet;

  @post op create(@body pet: Pet): Pet;
}
